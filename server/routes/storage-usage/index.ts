import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSsoConfig, isSsoAuthMode } from "../../lib/config.js";
import { parseStoredCloudEntitlement } from "../../lib/cloud-entitlement.js";
import { authenticate } from "../../lib/middleware.js";
import { prisma } from "../../lib/prisma.js";
import { normalizeStorageKey } from "../../lib/storage-access.js";
import {
  StorageQuotaError,
  listScopeObjects,
  objectReferences,
  requestObjectDeletion,
  requestScope,
  restoreDeletedObject,
  scopeUsage,
  storageLimitBytes,
} from "../../lib/storage-usage.js";

/**
 * Usage and Library for the active workspace (CLD-010 Tahap U and Q15). The scope always comes from the server-checked
 * `X-Team-Id` (or the caller's Personal Workspace), never from a parameter; another workspace's assets never appear.
 */
const router = Router();
const notFound = (res: Response) => res.status(404).json({ error: "Resource not found" });

async function aiUsage(teamId: string) {
  const team = await (prisma as any).team.findUnique({ where: { id: teamId }, select: { status: true, cloudEntitlement: true } });
  const entitlement = parseStoredCloudEntitlement(team?.cloudEntitlement);
  if (!entitlement || entitlement.capabilities.ai_assistant !== true || entitlement.limits.ai_credits <= 0) return { included: false };
  const start = entitlement.period_start ? new Date(entitlement.period_start) : null;
  const period = start && !Number.isNaN(start.getTime())
    ? await (prisma as any).cloudAiUsagePeriod.findUnique({ where: { teamId_periodStart: { teamId, periodStart: start } }, select: { consumedCredits: true, reservedCredits: true } })
    : null;
  const used = (period?.consumedCredits ?? 0) + (period?.reservedCredits ?? 0);
  return {
    included: true,
    used_credits: used,
    limit_credits: entitlement.limits.ai_credits,
    remaining_credits: Math.max(0, entitlement.limits.ai_credits - used),
    period_end: entitlement.period_end,
  };
}

router.get("/cloud/usage", authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const scope = requestScope(userId);
  if (!isSsoAuthMode() || !scope) return notFound(res);
  const [usage, limit, unused, recomputed] = await Promise.all([
    scopeUsage(scope),
    storageLimitBytes(scope),
    (prisma as any).storageObject.aggregate({
      where: { scopeType: scope.type, scopeId: scope.id, status: "committed", unreferencedSince: { not: null } },
      _sum: { bytes: true },
      _count: true,
    }),
    (prisma as any).storageUsage.findUnique({ where: { scopeType_scopeId: { scopeType: scope.type, scopeId: scope.id } }, select: { updatedAt: true } }),
  ]);
  // Only a Team Manager sees the upgrade link; every member sees the numbers (Q13). Personal has no paid upgrade (Q5).
  const team = scope.type === "team"
    ? await (prisma as any).team.findUnique({ where: { id: scope.id }, select: { ssoOrganizationId: true, members: { where: { userId, status: "active" }, select: { role: true } } } })
    : null;
  const upgradeUrl = team?.ssoOrganizationId && team.members?.[0]?.role === "manager"
    ? new URL(`/organizations/${encodeURIComponent(team.ssoOrganizationId)}`, getSsoConfig().issuerUrl).toString()
    : null;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    scope: scope.type,
    upgrade_url: upgradeUrl,
    storage: {
      used_bytes: usage.usedBytes,
      limit_bytes: limit,
      remaining_bytes: limit === null ? null : Math.max(0, limit - usage.usedBytes),
      document_bytes: usage.documentBytes,
      asset_bytes: usage.assetBytes,
      unused_bytes: Number(unused._sum.bytes ?? 0),
      unused_count: unused._count,
      documents_recomputed_at: recomputed?.updatedAt ?? null,
    },
    ai: scope.type === "team" ? await aiUsage(scope.id) : { included: false },
  });
});

const listQuery = z.object({
  filter: z.enum(["all", "unused"]).default("all"),
  sort: z.enum(["size", "date"]).default("size"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

router.get("/library", authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const scope = requestScope(userId);
  const query = listQuery.safeParse(req.query);
  if (!scope) return notFound(res);
  if (!query.success) return res.status(400).json({ error: "Invalid query" });
  const pageSize = 50;
  const result = await listScopeObjects(scope, { unusedOnly: query.data.filter === "unused", sort: query.data.sort, take: pageSize, skip: (query.data.page - 1) * pageSize });
  const manager = scope.type === "team"
    ? Boolean(await (prisma as any).teamMember.findFirst({ where: { teamId: scope.id, userId, status: "active", role: "manager" }, select: { id: true } }))
    : true;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    scope: scope.type,
    page: query.data.page,
    page_size: pageSize,
    total: result.total,
    can_bulk_delete: manager,
    items: result.items.map((item) => ({ ...item, can_delete: manager || item.uploaded_by === userId })),
  });
});

const keyBody = z.object({ key: z.string().min(1).max(512) });

/**
 * Resolves a key only inside the active scope, so a key from another workspace reads as missing. The scope itself was
 * checked by `authenticate` (Team membership) or is the caller's own Personal Workspace; delete and undo add their own rights check.
 */
async function scopedKey(req: Request): Promise<string | null> {
  const parsed = keyBody.safeParse(req.method === "GET" ? req.query : req.body);
  const key = parsed.success ? normalizeStorageKey(parsed.data.key) : null;
  const scope = requestScope((req as any).user.id);
  if (!key || !scope) return null;
  const object = await (prisma as any).storageObject.findUnique({ where: { key }, select: { scopeType: true, scopeId: true } });
  return object && object.scopeType === scope.type && object.scopeId === scope.id ? key : null;
}

router.get("/library/usage", authenticate, async (req: Request, res: Response) => {
  const key = await scopedKey(req);
  if (!key) return notFound(res);
  res.json({ documents: await objectReferences(key) });
});

router.delete("/library", authenticate, async (req: Request, res: Response) => {
  const key = await scopedKey(req);
  if (!key) return notFound(res);
  const outcome = await requestObjectDeletion((req as any).user.id, key);
  if (outcome === "in_use") return res.status(409).json({ error: "This file is still used by a document.", code: "STORAGE_OBJECT_IN_USE", documents: await objectReferences(key) });
  if (outcome !== "deleted") return notFound(res);
  res.json({ success: true });
});

router.post("/library/restore", authenticate, async (req: Request, res: Response) => {
  const key = await scopedKey(req);
  if (!key) return notFound(res);
  try {
    if (!await restoreDeletedObject((req as any).user.id, key)) return notFound(res);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof StorageQuotaError) return res.status(409).json({ error: err.message, code: err.code, used_bytes: err.usedBytes, limit_bytes: err.limitBytes });
    throw err;
  }
});

export default router;
