import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTeamScope } from "./team-scope.js";

const fixture = vi.hoisted(() => ({
  db: null as any,
  deleteFromS3: vi.fn(async () => undefined),
  objectExists: vi.fn(async () => true),
}));
vi.mock("./prisma.js", () => ({ get prisma() { return fixture.db; } }));
vi.mock("./config.js", () => ({ isLocalPostgres: () => true, isDesktopMode: () => false, isSsoAuthMode: () => true, useLocalAuth: () => true }));
vi.mock("./storage.js", () => ({
  getEnvStorageConfig: () => ({ type: "r2", bucketName: "bucket" }),
  buildS3Client: () => ({}),
  deleteFromS3: fixture.deleteFromS3,
  objectExists: fixture.objectExists,
}));
vi.mock("./db-connectors/registry.js", () => ({ fetchSchema: vi.fn(), testConnection: vi.fn() }));

const enabled = process.env.STORAGE_USAGE_INTEGRATION === "1";
const schema = `test_storage_usage_${randomUUID().replaceAll("-", "")}`;
const id = () => randomUUID();
const users = { owner: id(), member: id(), outsider: id(), gone: id() };
const teamId = id();
const otherTeamId = id();
const DAY = 24 * 60 * 60 * 1000;
let pool: pg.Pool;
let created = false;
let usage: typeof import("./storage-usage.js");
let maintenance: typeof import("./storage-maintenance.js");
let quota: typeof import("./personal-file-quota.js");
let project: any;

const entitlement = (limits: Record<string, unknown>) => JSON.stringify({
  product_type: "cloud",
  revision: "a".repeat(64),
  capabilities: {},
  limits: { max_members: 5, ai_credits: 0, ...limits },
  period_start: null,
  period_end: null,
});
const inTeam = <T>(run: () => Promise<T>) => runWithTeamScope({ mode: "team", teamId }, run) as Promise<T>;
const teamScope = { type: "team" as const, id: teamId, prefix: `team/org-${teamId}` };
const upload = (key: string, bytes: number, userId = users.owner) =>
  usage.reserveUpload({ scope: teamScope, key, userId, feature: "notes", mimeType: "image/png", bytes });

/** Needs a disposable localhost PostgreSQL schema; run with STORAGE_USAGE_INTEGRATION=1 and PRISMA_PG_LOCAL_CLIENT. */
describe.skipIf(!enabled)("CLD-010 storage accounting in an isolated PostgreSQL schema", () => {
  beforeAll(async () => {
    dotenv.config({ quiet: true });
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Storage tests require a localhost disposable schema.");
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const sql = execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.pg.prisma", "--script"], { encoding: "utf8", env: { ...process.env, DB_VARIANT: "pg" }, stdio: ["ignore", "pipe", "ignore"] });
    const connection = await pool.connect();
    try {
      await connection.query(`SET search_path TO "${schema}"`);
      await connection.query(sql.replaceAll('"public"', `"${schema}"`));
    } finally { connection.release(); }
    const require = createRequire(import.meta.url);
    const { PrismaClient } = require(process.env.PRISMA_PG_LOCAL_CLIENT || "@erdbpro/prisma-pg-local");
    // Raw recompute SQL is unqualified like production (public), so the test schema goes on the search_path too.
    fixture.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 6, options: `-c search_path=${schema}` }, { schema }) });
    [usage, maintenance, quota] = await Promise.all([import("./storage-usage.js"), import("./storage-maintenance.js"), import("./personal-file-quota.js")]);
  }, 30000);

  beforeEach(async () => {
    const db = fixture.db;
    vi.clearAllMocks();
    for (const model of ["storageObject", "storageUsage", "entityChange", "tableConstraint", "tableIndex", "relationship", "column", "entity", "diagram", "note", "drawing", "flowchart", "project", "teamMember", "team", "user"]) await db[model].deleteMany();
    for (const [name, userId] of Object.entries(users)) await db.user.create({ data: { id: userId, email: `${name}@example.test`, name, password: "fixture-only" } });
    const old = new Date(Date.now() - 30 * DAY);
    await db.team.create({ data: { id: teamId, name: "Team", status: "active", ssoOrganizationId: `org-${teamId}`, cloudEntitlement: entitlement({ max_storage_bytes: 1000 }), updatedAt: old } });
    await db.team.create({ data: { id: otherTeamId, name: "Other", status: "inactive", updatedAt: old } });
    for (const [team, userId, status] of [[teamId, users.owner, "active"], [teamId, users.member, "active"], [teamId, users.gone, "inactive"], [otherTeamId, users.outsider, "active"]]) {
      await db.teamMember.create({ data: { teamId: team, userId, status } });
    }
    project = await db.project.create({ data: { name: "Shared", teamId, userId: users.owner } });
  });

  it("upgrades existing storage rows additively and can reapply the document migration", async () => {
    const key = `erd-builder-pro/${teamScope.prefix}/notes/upgrade.png`;
    await upload(key, 25);
    const connection = await pool.connect();
    try {
      await connection.query(`SET search_path TO "${schema}"`);
      await connection.query('ALTER TABLE "storage_objects" DROP COLUMN "document_uid"');
      const sql = readFileSync(path.resolve("prisma/migrations-pg/20261016090000_add_storage_object_document/migration.sql"), "utf8");
      await connection.query(sql);
      await connection.query(sql);
    } finally { connection.release(); }
    expect(await fixture.db.storageObject.findUnique({ where: { key } })).toMatchObject({ key, bytes: 25, documentUid: null });
  });

  afterAll(async () => {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await fixture.db?.$disconnect();
    await pool?.end();
  });

  it("reserves uploads under the plan limit and lets only one of two racing uploads pass it", async () => {
    await upload("erd-builder-pro/team/x/notes/a.png", 600);
    await expect(upload("erd-builder-pro/team/x/notes/b.png", 600)).rejects.toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });

    await fixture.db.storageObject.deleteMany();
    const outcomes = await Promise.allSettled([upload("erd-builder-pro/team/x/notes/c.png", 600), upload("erd-builder-pro/team/x/notes/d.png", 600)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);

    await usage.settleUpload("erd-builder-pro/team/x/notes/c.png", false);
    await usage.settleUpload("erd-builder-pro/team/x/notes/d.png", false);
    expect(await fixture.db.storageObject.count()).toBe(0);
  });

  it("counts document text and ERD structure, keeps scopes apart, and refuses new files once full", async () => {
    await fixture.db.note.create({ data: { uid: id(), title: "", content: "x".repeat(300), projectId: project.id, userId: users.owner } });
    await fixture.db.note.create({ data: { uid: id(), title: "", content: "y".repeat(50), userId: users.owner } });
    const diagram = await fixture.db.diagram.create({ data: { uid: id(), name: "", projectId: project.id, userId: users.owner } });
    const entity = await fixture.db.entity.create({ data: { id: id(), diagramId: diagram.id, name: "users", x: 0, y: 0 } });
    await fixture.db.column.create({ data: { id: id(), entityId: entity.id, name: "id", type: "uuid" } });

    await maintenance.recomputeDocumentBytes();
    const team = await usage.scopeUsage({ type: "team", id: teamId });
    const personal = await usage.scopeUsage({ type: "user", id: users.owner });
    expect(team.documentBytes).toBeGreaterThan(300);
    expect(personal.documentBytes).toBe(50);

    // Fill the rest of the 1000-byte plan exactly: a new file is refused once used reaches the limit.
    await upload("erd-builder-pro/team/x/notes/big.png", 1000 - team.usedBytes);
    await expect(inTeam(() => quota.createPersonalFile("notes", users.owner, (db) => db.note.create({ data: { uid: id(), title: "n", projectId: project.id, userId: users.owner } }))))
      .rejects.toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });
  });

  it("caps Trial Team files per feature, counting Trash", async () => {
    await fixture.db.team.update({ where: { id: teamId }, data: { cloudEntitlement: entitlement({ max_team_files_per_feature: 1 }) } });
    const create = () => inTeam(() => quota.createPersonalFile("notes", users.owner, (db) => db.note.create({ data: { uid: id(), title: "n", projectId: project.id, userId: users.owner } })));
    const first = await create() as any;
    await fixture.db.note.update({ where: { id: first.id }, data: { isDeleted: true, deletedAt: new Date() } });
    await expect(create()).rejects.toMatchObject({ code: "TEAM_FILE_QUOTA_EXCEEDED" });
  });

  it("caps images per document by count and bytes, per document (G4)", async () => {
    await fixture.db.team.update({ where: { id: teamId }, data: { cloudEntitlement: entitlement({}) } });
    const inDoc = (n: number, bytes: number, doc = "note-a") =>
      usage.reserveUpload({ scope: teamScope, key: `erd-builder-pro/team/x/notes/${doc}-${n}.png`, userId: users.owner, feature: "notes", mimeType: "image/png", bytes, documentUid: doc });
    for (let n = 0; n < usage.DOCUMENT_IMAGE_LIMIT; n++) await inDoc(n, 10);
    await expect(inDoc(99, 10)).rejects.toMatchObject({ code: "DOCUMENT_IMAGE_BUDGET_EXCEEDED" });
    await inDoc(0, 10, "note-b");
    await expect(inDoc(1, usage.DOCUMENT_IMAGE_BYTES, "note-b")).rejects.toMatchObject({ code: "DOCUMENT_IMAGE_BUDGET_EXCEEDED" });

    // An image the sweep found unused no longer counts toward its document.
    await fixture.db.storageObject.update({ where: { key: "erd-builder-pro/team/x/notes/note-a-0.png" }, data: { unreferencedSince: new Date() } });
    await inDoc(100, 10);
  });

  it("authorizes reads by the owner scope, not by which document mentions the key", async () => {
    const teamKey = "erd-builder-pro/team/x/notes/t.png";
    const userKey = "erd-builder-pro/user/u/notes/u.png";
    await upload(teamKey, 10, users.member);
    await usage.reserveUpload({ scope: { type: "user", id: users.owner, prefix: "user/u" }, key: userKey, userId: users.owner, feature: "notes", mimeType: "image/png", bytes: 10 });
    // The outsider pastes both keys into a note of their own: that grants nothing.
    await fixture.db.note.create({ data: { uid: id(), title: "", content: `<img src="/api/serve/${teamKey}"><img src="/api/serve/${userKey}">`, userId: users.outsider } });

    expect(await usage.trackedObjectAccess(users.member, teamKey)).toEqual({ tracked: true, canRead: true, canManage: true });
    expect(await usage.trackedObjectAccess(users.owner, teamKey)).toEqual({ tracked: true, canRead: true, canManage: false });
    for (const userId of [users.outsider, users.gone]) expect((await usage.trackedObjectAccess(userId, teamKey) as any).canRead).toBe(false);
    expect((await usage.trackedObjectAccess(users.owner, userKey) as any).canRead).toBe(true);
    expect((await usage.trackedObjectAccess(users.member, userKey) as any).canRead).toBe(false);
    expect(await usage.trackedObjectAccess(users.owner, "erd-builder-pro/notes/legacy.png")).toEqual({ tracked: false });
  });

  it("marks, clears and only after the grace deletes unreferenced objects, keeping revision references", async () => {
    const keys = { used: "erd-builder-pro/team/x/notes/used.png", revision: "erd-builder-pro/team/x/notes/rev.png", old: "erd-builder-pro/team/x/notes/old.png", fresh: "erd-builder-pro/team/x/notes/fresh.png" };
    for (const key of Object.values(keys)) await upload(key, 10);
    await fixture.db.storageObject.updateMany({ data: { status: "committed" } });
    await fixture.db.note.create({ data: { uid: id(), title: "", content: `<img src="/api/serve/${keys.used}">`, projectId: project.id, userId: users.owner } });
    await fixture.db.entityChange.create({ data: { entityType: "notes", entityId: "1", version: 1, changes: JSON.stringify({ snapshot: { content: `<img src=\"/api/serve/${keys.revision}\">` } }) } });
    await fixture.db.storageObject.update({ where: { key: keys.old }, data: { unreferencedSince: new Date(Date.now() - 31 * DAY) } });
    await fixture.db.storageObject.update({ where: { key: keys.used }, data: { unreferencedSince: new Date(Date.now() - 31 * DAY) } });

    const result = await maintenance.sweepStorageObjects();
    expect(result).toMatchObject({ marked: 1, cleared: 1, deleted: 1 });
    expect(fixture.deleteFromS3).toHaveBeenCalledTimes(1);
    expect(fixture.deleteFromS3).toHaveBeenCalledWith(expect.anything(), expect.anything(), keys.old);
    const rows = await fixture.db.storageObject.findMany({ orderBy: { key: "asc" } });
    expect(rows.map((row: any) => [row.key, row.unreferencedSince === null])).toEqual([
      [keys.fresh, false],
      [keys.revision, true],
      [keys.used, true],
    ]);

    // Unreferenced objects stop counting after seven days but still hold bytes until removed.
    await fixture.db.storageObject.update({ where: { key: keys.fresh }, data: { unreferencedSince: new Date(Date.now() - 8 * DAY) } });
    expect(await usage.scopeUsage({ type: "team", id: teamId })).toMatchObject({ assetBytes: 20, heldBytes: 30 });
  });

  it("marks a Library delete, refuses it while used, lists only the active scope, and can undo it", async () => {
    const used = "erd-builder-pro/team/x/notes/in-use.png";
    const spare = "erd-builder-pro/team/x/notes/spare.png";
    await upload(used, 100, users.member);
    await upload(spare, 200, users.member);
    await usage.reserveUpload({ scope: { type: "user", id: users.member, prefix: "user/m" }, key: "erd-builder-pro/user/m/notes/own.png", userId: users.member, feature: "notes", mimeType: "image/png", bytes: 5 });
    await fixture.db.storageObject.updateMany({ data: { status: "committed" } });
    await fixture.db.note.create({ data: { uid: id(), title: "Spec", content: `<img src="/api/serve/${used}">`, projectId: project.id, userId: users.owner, isDeleted: true, deletedAt: new Date() } });

    const listed = await usage.listScopeObjects({ type: "team", id: teamId }, { unusedOnly: false, sort: "size", take: 50, skip: 0 });
    expect(listed.items.map((item) => item.key)).toEqual([spare, used]);

    expect(await usage.requestObjectDeletion(users.member, used)).toBe("in_use");
    expect(await usage.requestObjectDeletion(users.owner, spare)).toBe("not_found");
    expect(await usage.requestObjectDeletion(users.member, spare)).toBe("deleted");
    expect(await usage.scopeUsage({ type: "team", id: teamId })).toMatchObject({ assetBytes: 100, heldBytes: 300 });

    expect(await usage.restoreDeletedObject(users.outsider, spare)).toBe(false);
    expect(await usage.restoreDeletedObject(users.member, spare)).toBe(true);
    expect(await usage.scopeUsage({ type: "team", id: teamId })).toMatchObject({ assetBytes: 300 });
  });

  it("lists the active Team Trash and empties only the caller's items in that scope", async () => {
    const { fetchTrashItems, emptyTrash } = await import("../routes/common/service.js");
    const mine = await fixture.db.note.create({ data: { uid: id(), title: "mine", projectId: project.id, userId: users.owner, isDeleted: true, deletedAt: new Date() } });
    const colleague = await fixture.db.note.create({ data: { uid: id(), title: "colleague", projectId: project.id, userId: users.member, isDeleted: true, deletedAt: new Date() } });
    const personal = await fixture.db.note.create({ data: { uid: id(), title: "personal", userId: users.owner, isDeleted: true, deletedAt: new Date() } });
    const otherProject = await fixture.db.project.create({ data: { name: "Other", teamId: otherTeamId, userId: users.owner } });
    const other = await fixture.db.note.create({ data: { uid: id(), title: "other", projectId: otherProject.id, userId: users.owner, isDeleted: true, deletedAt: new Date() } });

    const teamTrash = await inTeam(() => fetchTrashItems(users.owner));
    expect(teamTrash.notes.map((note: any) => note.id).sort()).toEqual([mine.id, colleague.id].sort());
    const personalTrash = await runWithTeamScope({ mode: "personal", teamId: null }, () => fetchTrashItems(users.owner));
    expect(personalTrash.notes.map((note: any) => note.id)).toEqual([personal.id]);
    expect(await inTeam(() => emptyTrash(users.owner))).toBe(1);
    expect((await fixture.db.note.findMany()).map((note: any) => note.id).sort()).toEqual([colleague.id, personal.id, other.id].sort());
  });

  it("purges Trash older than 30 days with its revisions, but not recent items or inactive Teams", async () => {
    const old = new Date(Date.now() - 31 * DAY);
    const expired = await fixture.db.note.create({ data: { uid: id(), title: "old", projectId: project.id, userId: users.owner, isDeleted: true, deletedAt: old } });
    const recent = await fixture.db.note.create({ data: { uid: id(), title: "new", projectId: project.id, userId: users.owner, isDeleted: true, deletedAt: new Date(Date.now() - 29 * DAY) } });
    const otherProject = await fixture.db.project.create({ data: { name: "Locked", teamId: otherTeamId, userId: users.outsider } });
    const locked = await fixture.db.note.create({ data: { uid: id(), title: "locked", projectId: otherProject.id, userId: users.outsider, isDeleted: true, deletedAt: old } });
    const personal = await fixture.db.drawing.create({ data: { uid: id(), title: "mine", userId: users.owner, isDeleted: true, deletedAt: old } });
    await fixture.db.entityChange.create({ data: { entityType: "notes", entityId: String(expired.id), version: 1, changes: "{}" } });

    expect(await maintenance.purgeExpiredTrash()).toBe(2);
    expect((await fixture.db.note.findMany({ select: { id: true } })).map((row: any) => row.id).sort()).toEqual([recent.id, locked.id].sort());
    expect(await fixture.db.drawing.count({ where: { id: personal.id } })).toBe(0);
    expect(await fixture.db.entityChange.count()).toBe(0);
  });

  it("reports storage per Team organization for telemetry without content", async () => {
    await fixture.db.note.create({ data: { uid: id(), title: "", content: "z".repeat(40), projectId: project.id, userId: users.owner } });
    await upload("erd-builder-pro/team/x/notes/t.png", 25);
    await maintenance.recomputeDocumentBytes();
    const { aggregateStorageUsage } = await import("./cloud-telemetry.js");
    const reports = await aggregateStorageUsage("2026-10-15T00:00:00.000Z");
    expect(reports).toEqual([expect.objectContaining({
      organization_id: `org-${teamId}`,
      document_bytes: 40,
      asset_bytes: 25,
      unused_asset_bytes: 0,
      files: { diagrams: 0, notes: 1, drawings: 0, flowcharts: 0 },
    })]);
  });

  it("prunes revisions older than 30 days of every type", async () => {
    for (const [changeType, days] of [["update", 31], ["create", 40], ["update", 1]] as const) {
      await fixture.db.entityChange.create({ data: { entityType: "notes", entityId: "9", version: days, changeType, changes: "{}", createdAt: new Date(Date.now() - days * DAY) } });
    }
    expect(await maintenance.pruneRevisions()).toBe(2);
    expect(await fixture.db.entityChange.count()).toBe(1);
  });
});
