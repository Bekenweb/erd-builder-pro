import { isLocalPostgres, isSsoAuthMode } from "./config.js";
import { parseStoredCloudEntitlement } from "./cloud-entitlement.js";
import { prisma } from "./prisma.js";
import { currentTeamScope } from "./team-scope.js";

/**
 * Storage accounting for PostgreSQL modes (CLD-010). Every upload gets a `storage_objects` row that names its
 * owner scope, so quota, the Library, background cleanup and read access never depend on document content.
 * Limits apply only in Cloud (SSO); Self-host records rows for isolation and cleanup but has no byte limit.
 */

export type StorageScopeType = "team" | "user";
export type StorageScope = { type: StorageScopeType; id: string; prefix: string };

export const PERSONAL_STORAGE_DEFAULT_BYTES = 25 * 1024 * 1024;
/** Unreferenced objects stop counting after this many days and are physically removed after the grace (Q17). */
export const UNREFERENCED_COUNT_DAYS = 7;
export const OBJECT_GRACE_DAYS = 30;
/** Bytes kept for a scope, counted or not, may not exceed this multiple of its limit (Q17). */
export const HELD_BYTES_MULTIPLIER = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export class StorageQuotaError extends Error {
  readonly code = "STORAGE_QUOTA_EXCEEDED";
  readonly status = 409;

  constructor(readonly usedBytes: number, readonly limitBytes: number) {
    super("This workspace has used its storage limit. Delete unused images or upgrade the plan.");
    this.name = "StorageQuotaError";
  }
}

export function storageTrackingEnabled(): boolean {
  return Boolean(prisma) && isLocalPostgres();
}

/** Owner scope of a new upload: the active Team, or the signed-in user's Personal Workspace. */
export async function resolveStorageScope(userId: string): Promise<StorageScope | null> {
  const scope = currentTeamScope();
  if (!scope || !storageTrackingEnabled()) return null;
  if (scope.mode === "team" && scope.teamId) {
    const team = await (prisma as any).team.findUnique({ where: { id: scope.teamId }, select: { ssoOrganizationId: true } });
    // Cloud folders use the SaaS organization ID; Self-host has none and uses the local Team ID (Q14, Q16).
    return { type: "team", id: scope.teamId, prefix: `team/${team?.ssoOrganizationId || scope.teamId}` };
  }
  return { type: "user", id: userId, prefix: `user/${userId}` };
}

/** Byte limit of a scope from its signed entitlement; null when unlimited (Self-host, or no limit in the plan). */
export async function storageLimitBytes(scope: { type: StorageScopeType; id: string }, db: any = prisma): Promise<number | null> {
  if (!isSsoAuthMode()) return null;
  if (scope.type === "team") {
    const team = await db.team.findUnique({ where: { id: scope.id }, select: { status: true, cloudEntitlement: true } });
    return parseStoredCloudEntitlement(team?.cloudEntitlement)?.limits.max_storage_bytes ?? null;
  }
  const user = await db.user.findUnique({ where: { id: scope.id }, select: { cloudPersonalEntitlement: true } });
  // Personal storage is uniform for everyone (Q5); claims issued before the field existed fall back to it.
  return parseStoredCloudEntitlement(user?.cloudPersonalEntitlement)?.limits.max_storage_bytes ?? PERSONAL_STORAGE_DEFAULT_BYTES;
}

export type ScopeUsage = { documentBytes: number; assetBytes: number; heldBytes: number; usedBytes: number };

/** Used bytes = recomputed document bytes + objects still counted; held bytes also include objects in their grace. */
export async function scopeUsage(scope: { type: StorageScopeType; id: string }, db: any = prisma): Promise<ScopeUsage> {
  const countedSince = new Date(Date.now() - UNREFERENCED_COUNT_DAYS * DAY_MS);
  const where = { scopeType: scope.type, scopeId: scope.id };
  const [usage, counted, held] = await Promise.all([
    db.storageUsage.findUnique({ where: { scopeType_scopeId: where }, select: { documentBytes: true } }),
    db.storageObject.aggregate({
      where: { ...where, status: { in: ["pending", "committed"] }, OR: [{ unreferencedSince: null }, { unreferencedSince: { gt: countedSince } }] },
      _sum: { bytes: true },
    }),
    db.storageObject.aggregate({ where, _sum: { bytes: true } }),
  ]);
  const documentBytes = Number(usage?.documentBytes ?? 0);
  const assetBytes = Number(counted._sum.bytes ?? 0);
  return { documentBytes, assetBytes, heldBytes: Number(held._sum.bytes ?? 0), usedBytes: documentBytes + assetBytes };
}

/** Serializes quota decisions per scope inside the caller's transaction. */
async function lockScope(db: any, scope: { type: StorageScopeType; id: string }) {
  await db.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `storage:${scope.type}:${scope.id}`);
}

/** Refuses to create a file when the scope's storage is already full (Q4); editing existing files is never blocked. */
export async function assertStorageAvailable(db: any, scope: { type: StorageScopeType; id: string }): Promise<void> {
  if (!storageTrackingEnabled()) return;
  const limit = await storageLimitBytes(scope, db);
  if (limit === null) return;
  const usage = await scopeUsage(scope, db);
  if (usage.usedBytes >= limit) throw new StorageQuotaError(usage.usedBytes, limit);
}

/** Records an upload as `pending` before it reaches the bucket, refusing it when it would pass the limit. */
export async function reserveUpload(input: {
  scope: StorageScope;
  key: string;
  userId: string;
  feature: string;
  mimeType: string;
  bytes: number;
}): Promise<void> {
  await (prisma as any).$transaction(async (db: any) => {
    const limit = await storageLimitBytes(input.scope, db);
    if (limit !== null) {
      await lockScope(db, input.scope);
      const usage = await scopeUsage(input.scope, db);
      if (usage.usedBytes + input.bytes > limit || usage.heldBytes + input.bytes > limit * HELD_BYTES_MULTIPLIER) {
        throw new StorageQuotaError(usage.usedBytes, limit);
      }
    }
    await db.storageObject.create({
      data: {
        key: input.key,
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        uploadedBy: input.userId,
        feature: input.feature,
        mimeType: input.mimeType,
        bytes: input.bytes,
        status: "pending",
      },
    });
  });
}

/** Settles a reservation: kept when the object is in the bucket, released when it never arrived. */
export async function settleUpload(key: string, stored: boolean): Promise<void> {
  if (stored) {
    await (prisma as any).storageObject.update({ where: { key }, data: { status: "committed" } });
  } else {
    await (prisma as any).storageObject.deleteMany({ where: { key, status: "pending" } });
  }
}

export type TrackedAccess = { tracked: false } | { tracked: true; canRead: boolean; canManage: boolean };

/**
 * Read access from the object's owner scope (H8): the uploader's Personal Workspace, or an active Team where the
 * caller is an active member. A key pasted into another workspace's document grants nothing.
 */
export async function trackedObjectAccess(userId: string, key: string): Promise<TrackedAccess> {
  if (!storageTrackingEnabled()) return { tracked: false };
  const object = await (prisma as any).storageObject.findUnique({ where: { key } });
  if (!object) return { tracked: false };
  if (object.status === "deleted") return { tracked: true, canRead: false, canManage: false };
  if (object.scopeType === "user") {
    const own = object.scopeId === userId;
    return { tracked: true, canRead: own, canManage: own };
  }
  const member = await (prisma as any).teamMember.findFirst({
    where: { teamId: object.scopeId, userId, status: "active", team: { status: "active" } },
    select: { role: true },
  });
  return { tracked: true, canRead: Boolean(member), canManage: Boolean(member) && (member.role === "manager" || object.uploadedBy === userId) };
}

/** Documents (including Trash) and surviving revisions that still use a key, in every scope. */
export async function objectReferences(key: string): Promise<Array<{ type: "notes" | "drawings"; uid: string | null; title: string; isDeleted: boolean }>> {
  const db = prisma as any;
  const [notes, drawings, revisions] = await Promise.all([
    db.note.findMany({ where: { content: { contains: key } }, select: { uid: true, title: true, isDeleted: true }, take: 20 }),
    db.drawing.findMany({ where: { data: { contains: key } }, select: { uid: true, title: true, isDeleted: true }, take: 20 }),
    db.entityChange.count({ where: { entityType: { in: ["notes", "note", "drawings", "drawing"] }, changes: { contains: key } } }),
  ]);
  const documents = [
    ...notes.map((note: any) => ({ type: "notes" as const, uid: note.uid, title: note.title, isDeleted: Boolean(note.isDeleted) })),
    ...drawings.map((drawing: any) => ({ type: "drawings" as const, uid: drawing.uid, title: drawing.title, isDeleted: Boolean(drawing.isDeleted) })),
  ];
  // A revision-only reference still blocks deletion, so restoring that revision keeps its image (H1, Q20).
  return revisions > 0 && documents.length === 0 ? [{ type: "notes", uid: null, title: "Revision history", isDeleted: false }] : documents;
}

export type DeletionOutcome = "deleted" | "in_use" | "not_found" | "untracked";

/**
 * A user delete only marks the object (H3): refused while anything references it, otherwise it stops counting at once
 * and the bucket copy is removed by background cleanup after the grace, so it can be undone until then.
 */
export async function requestObjectDeletion(userId: string, key: string): Promise<DeletionOutcome> {
  const access = await trackedObjectAccess(userId, key);
  if (!access.tracked) return "untracked";
  if (!access.canManage) return "not_found";
  if ((await objectReferences(key)).length > 0) return "in_use";
  const now = new Date();
  await (prisma as any).storageObject.updateMany({
    where: { key, status: { in: ["pending", "committed"] } },
    data: { status: "deleted", deletedAt: now, unreferencedSince: now },
  });
  return "deleted";
}

/** Undoes a delete during the grace. */
export async function restoreDeletedObject(userId: string, key: string): Promise<boolean> {
  if (!storageTrackingEnabled()) return false;
  const object = await (prisma as any).storageObject.findUnique({ where: { key } });
  if (!object || object.status !== "deleted") return false;
  const member = object.scopeType === "team"
    ? await (prisma as any).teamMember.findFirst({ where: { teamId: object.scopeId, userId, status: "active", team: { status: "active" } }, select: { role: true } })
    : null;
  const allowed = object.scopeType === "user" ? object.scopeId === userId : Boolean(member) && (member.role === "manager" || object.uploadedBy === userId);
  if (!allowed) return false;
  // Back to counted: it must still fit the limit like a new upload would.
  await (prisma as any).$transaction(async (db: any) => {
    const scope = { type: object.scopeType as StorageScopeType, id: object.scopeId };
    const limit = await storageLimitBytes(scope, db);
    if (limit !== null) {
      await lockScope(db, scope);
      const usage = await scopeUsage(scope, db);
      if (usage.usedBytes + object.bytes > limit) throw new StorageQuotaError(usage.usedBytes, limit);
    }
    await db.storageObject.update({ where: { key }, data: { status: "committed", deletedAt: null, unreferencedSince: new Date() } });
  });
  return true;
}

/** Library rows of the active workspace scope only, from every member, newest or largest first (Q15). */
export async function listScopeObjects(scope: { type: StorageScopeType; id: string }, options: { unusedOnly: boolean; sort: "size" | "date"; take: number; skip: number }) {
  const db = prisma as any;
  const where = {
    scopeType: scope.type,
    scopeId: scope.id,
    status: { in: ["committed", "deleted"] },
    ...(options.unusedOnly ? { unreferencedSince: { not: null } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.storageObject.findMany({
      where,
      orderBy: options.sort === "size" ? [{ bytes: "desc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }],
      take: options.take,
      skip: options.skip,
    }),
    db.storageObject.count({ where }),
  ]);
  const uploaderIds = [...new Set(rows.map((row: any) => row.uploadedBy).filter(Boolean))];
  const uploaders = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, email: true } })
    : [];
  const names = new Map(uploaders.map((user: any) => [user.id, user.name || user.email]));
  return {
    total,
    items: rows.map((row: any) => ({
      key: row.key,
      feature: row.feature,
      mime_type: row.mimeType,
      bytes: row.bytes,
      status: row.status,
      unused: row.unreferencedSince !== null,
      uploaded_by: row.uploadedBy,
      uploaded_by_name: row.uploadedBy ? names.get(row.uploadedBy) ?? null : null,
      created_at: row.createdAt,
      deleted_at: row.deletedAt,
    })),
  };
}

/** The scope of the request: the active Team, or the caller's Personal Workspace. */
export function requestScope(userId: string): { type: StorageScopeType; id: string } | null {
  const scope = currentTeamScope();
  if (!scope || !storageTrackingEnabled()) return null;
  return scope.mode === "team" && scope.teamId ? { type: "team", id: scope.teamId } : { type: "user", id: userId };
}
