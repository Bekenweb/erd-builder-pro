import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ db: null as any }));
vi.mock("./prisma.js", () => ({ get prisma() { return fixture.db; } }));
const schema = `test_sh_legacy_${randomUUID().replaceAll("-", "")}`;
const ownerId = randomUUID(), adminId = randomUUID(), otherId = randomUUID();
const teamA = randomUUID(), teamB = randomUUID();
const envKeys = ["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL", "AUTH_MODE", "ERD_INSTALL_MODE", "NODE_ENV",
  "ERDBPRO_INSTALLATION_IDENTITY_FILE", "ERDBPRO_LICENSE_STATE_FILE", "ERDBPRO_LEGACY_TEAM_ID"];
const previous = new Map<string, string | undefined>();
let directory = "", created = false, pool: pg.Pool | undefined;
let migration: typeof import("./startup-migration.js");
let identity: typeof import("./installation-identity.js");
let mcp: typeof import("../mcp/public-service.js");
let project: any, adminProject: any, orphan: any, note: any;

async function legacyTeam(id: string) {
  await fixture.db.team.create({ data: { id, name: id, type: "team", status: "active" } });
}
async function legacyMembership(id: string, status = "active") {
  return fixture.db.teamMember.create({ data: { teamId: id, userId: ownerId, role: "member", status } });
}
async function storedProject() {
  return fixture.db.project.findUnique({ where: { id: project.id } });
}
async function rerun() {
  await migration.applySchemaMigrations();
  await migration.backfillUids();
}

describe.skipIf(process.env.TEAM_MIGRATION_INTEGRATION !== "1")("SH-002 legacy scope migration (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    for (const key of envKeys) previous.set(key, process.env[key]);
    dotenv.config({ quiet: true });
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Only a localhost disposable schema is allowed.");
    directory = mkdtempSync(path.join(tmpdir(), "erd-legacy-team-"));
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const sql = execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff",
      "--from-empty", "--to-schema", "prisma/schema.pg.prisma", "--script"],
    { encoding: "utf8", env: { ...process.env, DB_VARIANT: "pg" }, stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
    const connection = await pool.connect();
    try {
      await connection.query(`SET search_path TO "${schema}"`);
      await connection.query(sql.replaceAll('"public"', `"${schema}"`));
    } finally { connection.release(); }
    // Raw startup SQL must also stay inside the fixture, not merely Prisma model queries.
    url.searchParams.set("options", `-csearch_path=${schema}`);
    Object.assign(process.env, { DATABASE_URL: url.toString(), SUPABASE_URL: "", VITE_SUPABASE_URL: "", AUTH_MODE: "",
      ERD_INSTALL_MODE: "web", NODE_ENV: "test", ERDBPRO_LEGACY_TEAM_ID: "",
      ERDBPRO_INSTALLATION_IDENTITY_FILE: path.join(directory, "installation-identity.json"),
      ERDBPRO_LICENSE_STATE_FILE: path.join(directory, "license-state.json") });
    const { PrismaClient } = createRequire(import.meta.url)("@erdbpro/prisma-pg-local");
    fixture.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }) });
    expect(await fixture.db.$queryRawUnsafe("SELECT current_schema() AS name")).toEqual([{ name: schema }]);
    [migration, identity, mcp] = await Promise.all([
      import("./startup-migration.js"), import("./installation-identity.js"), import("../mcp/public-service.js"),
    ]);
    identity.ensureInstallationIdentity();
  }, 60000);

  beforeEach(async () => {
    process.env.AUTH_MODE = "";
    process.env.ERDBPRO_LEGACY_TEAM_ID = "";
    rmSync(path.join(directory, "team-provisioning-baseline-v1"), { force: true });
    for (const model of ["diagram", "note", "drawing", "flowchart", "project", "teamAuditEvent", "teamMember", "team", "user"]) {
      await fixture.db[model].deleteMany();
    }
    await fixture.db.user.createMany({ data: [
      { id: ownerId, email: "owner@example.test", password: "fixture-only" },
      { id: adminId, email: "admin@example.test", password: "fixture-only", isSuperAdmin: true },
      { id: otherId, email: "other@example.test", password: "fixture-only" },
    ] });
    project = await fixture.db.project.create({ data: { userId: ownerId, name: "Legacy owner project" } });
    adminProject = await fixture.db.project.create({ data: { userId: adminId, name: "Admin Personal" } });
    orphan = await fixture.db.project.create({ data: { name: "Unresolved owner" } });
    note = await fixture.db.note.create({ data: { uid: randomUUID(), userId: ownerId, projectId: project.id,
      title: "Retained note", content: "<p>Keep legacy content</p>" } });
  });

  afterAll(async () => {
    await fixture.db?.$disconnect();
    if (created) {
      await pool!.query(`DROP SCHEMA "${schema}" CASCADE`);
      expect((await pool!.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema])).rows).toEqual([]);
    }
    await pool?.end();
    if (directory) rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }, 30000);

  it("preserves Personal projects on later startups and never seals newly inserted records", async () => {
    await legacyTeam(teamA); await legacyTeam(teamB);
    await legacyMembership(teamA); await legacyMembership(teamB);
    identity.claimTeamProvisioningBaseline();
    await rerun(); await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null, userId: ownerId });
    expect(await fixture.db.team.findUnique({ where: { id: teamA } })).toMatchObject({ provisioningSignature: null });
    expect(await fixture.db.teamMember.findMany()).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "member", provisioningSignature: null }),
    ]));
    expect(await mcp.readPublicDocument(ownerId, "notes", note.uid)).toMatchObject({ content: note.content });
    await expect(mcp.readPublicDocument(otherId, "notes", note.uid)).rejects.toThrow("Document not found");
  }, 15000);

  it("keeps ambiguous legacy memberships for manual recovery instead of choosing the last Team", async () => {
    await legacyTeam(teamA); await legacyTeam(teamB);
    await legacyMembership(teamA); await legacyMembership(teamB);
    await rerun(); await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    const events = await fixture.db.teamAuditEvent.findMany({ where: { targetId: String(project.id), action: "legacy_recovery_required" } });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].metadata).reason).toBe("ambiguous_team_membership");
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
  }, 15000);

  it("uses an explicit active Team mapping once, preserves Admin Personal and unresolved owners", async () => {
    await legacyTeam(teamA);
    process.env.ERDBPRO_LEGACY_TEAM_ID = teamA;
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: teamA, userId: ownerId });
    expect(await fixture.db.project.findUnique({ where: { id: adminProject.id } })).toMatchObject({ teamId: null, userId: adminId });
    expect(await fixture.db.project.findUnique({ where: { id: orphan.id } })).toMatchObject({ teamId: null, userId: null });
    const membership = await fixture.db.teamMember.findUnique({ where: { teamId_userId: { teamId: teamA, userId: ownerId } } });
    const signatures = await import("./team-provisioning.js");
    expect(signatures.isProvisionedMembership(membership)).toBe(true);
    expect(membership).toMatchObject({ status: "active", role: "staff" });
    const before = await fixture.db.teamAuditEvent.count();
    await rerun();
    expect(await fixture.db.teamAuditEvent.count()).toBe(before);
    expect(await fixture.db.team.count()).toBe(1);
    expect(await fixture.db.teamMember.count()).toBe(1);
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
  }, 15000);

  it("does not expose a legacy Personal project through its owner's single Team membership", async () => {
    await legacyTeam(teamA); await legacyMembership(teamA);
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
    expect(await fixture.db.teamAuditEvent.count({ where: { targetId: String(project.id), action: "legacy_recovery_required" } })).toBe(1);
  }, 15000);

  it.each(["none", "inactive", "banned"])("does not infer or reactivate a %s membership", async (status) => {
    await legacyTeam(teamA);
    if (status !== "none") {
      await legacyMembership(teamA, status);
      process.env.ERDBPRO_LEGACY_TEAM_ID = teamA;
    }
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    const members = await fixture.db.teamMember.findMany({ where: { userId: ownerId } });
    expect(members).toHaveLength(status === "none" ? 0 : 1);
    if (status !== "none") expect(members[0].status).toBe(status);
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
  }, 15000);

  it("never assigns or seals local legacy records in Cloud SSO mode", async () => {
    await legacyTeam(teamA); await legacyMembership(teamA);
    process.env.AUTH_MODE = "sso";
    await rerun(); await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    expect(await fixture.db.team.findUnique({ where: { id: teamA } })).toMatchObject({ provisioningSignature: null });
    expect(identity.hasTeamProvisioningBaseline()).toBe(false);
  }, 15000);

  it("refuses an explicit mapping to a Team with a known invalid signature", async () => {
    await legacyTeam(teamA);
    await fixture.db.team.update({ where: { id: teamA }, data: { provisioningSignature: "manual-invalid" } });
    process.env.ERDBPRO_LEGACY_TEAM_ID = teamA;
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    expect(await fixture.db.team.findUnique({ where: { id: teamA } })).toMatchObject({ provisioningSignature: "manual-invalid" });
    expect(await fixture.db.teamMember.count()).toBe(0);
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
  }, 15000);

  it("retries only recorded recovery projects when an admin later supplies a mapping", async () => {
    await legacyTeam(teamA); await legacyTeam(teamB);
    await legacyMembership(teamA); await legacyMembership(teamB);
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null });
    const personal = await fixture.db.project.create({ data: { userId: ownerId, name: "New Personal after upgrade" } });
    process.env.ERDBPRO_LEGACY_TEAM_ID = teamA;
    await rerun(); await rerun();
    expect(await storedProject()).toMatchObject({ teamId: teamA });
    expect(await fixture.db.project.findUnique({ where: { id: personal.id } })).toMatchObject({ teamId: null });
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(note);
  }, 15000);

  it("adds missing legacy columns and UIDs in the selected schema without losing file data", async () => {
    const drawing = await fixture.db.drawing.create({ data: { projectId: project.id, title: "Legacy drawing", data: '{"elements":[{"id":"retained-shape"}]}' } });
    const flowchart = await fixture.db.flowchart.create({ data: { projectId: project.id, title: "Legacy flowchart", data: '{"nodes":[{"id":"retained-node"}],"edges":[]}' } });
    const diagram = await fixture.db.diagram.create({ data: { projectId: project.id, name: "Legacy ERD", dbmlSource: "Table retained { id text }" } });
    const entity = await fixture.db.entity.create({ data: { id: randomUUID(), diagramId: diagram.id, name: "retained", x: 23, y: 41 } });
    await fixture.db.column.create({ data: { id: "legacy-column", entityId: entity.id, name: "id", type: "text" } });
    await fixture.db.note.update({ where: { id: note.id }, data: { uid: null } });
    await fixture.db.$executeRawUnsafe('ALTER TABLE "projects" DROP COLUMN "team_id" CASCADE');
    await fixture.db.$executeRawUnsafe('ALTER TABLE "users" DROP COLUMN "must_change_password"');
    await rerun();
    expect(await storedProject()).toMatchObject({ teamId: null, userId: ownerId });
    const upgraded = await fixture.db.note.findUnique({ where: { id: note.id } });
    expect(upgraded.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(upgraded).toMatchObject({ id: note.id, content: note.content, userId: ownerId, projectId: project.id });
    const upgradedDrawing = await fixture.db.drawing.findUnique({ where: { id: drawing.id } });
    const upgradedFlowchart = await fixture.db.flowchart.findUnique({ where: { id: flowchart.id } });
    const upgradedDiagram = await fixture.db.diagram.findUnique({ where: { id: diagram.id }, include: { entities: { include: { columns: true } } } });
    for (const row of [upgradedDrawing, upgradedFlowchart, upgradedDiagram]) {
      expect(row.uid).toMatch(/^[0-9a-f-]{36}$/);
      expect(row).toMatchObject({ userId: ownerId, projectId: project.id });
    }
    expect(upgradedDrawing.data).toBe(drawing.data);
    expect(upgradedFlowchart.data).toBe(flowchart.data);
    expect(upgradedDiagram).toMatchObject({ dbmlSource: diagram.dbmlSource,
      entities: [{ id: entity.id, x: 23, y: 41, columns: [{ id: "legacy-column", name: "id", type: "text" }] }] });
    await rerun();
    expect(await fixture.db.note.findUnique({ where: { id: note.id } })).toEqual(upgraded);
    expect(await fixture.db.drawing.findUnique({ where: { id: drawing.id } })).toEqual(upgradedDrawing);
    expect(await fixture.db.flowchart.findUnique({ where: { id: flowchart.id } })).toEqual(upgradedFlowchart);
    expect(await fixture.db.diagram.findUnique({ where: { id: diagram.id }, include: { entities: { include: { columns: true } } } })).toEqual(upgradedDiagram);
    expect(await fixture.db.project.count()).toBe(3);
    expect(await fixture.db.user.count()).toBe(3);
  }, 15000);
});
