import { fetchWithTimeout, getCloudMachineToken, isPostgresDatabase } from "./cloud-ai.js";
import { getCloudTelemetryConfig, isSsoAuthMode } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

const CLOUD_TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;
const CLOUD_AI_USAGE_WINDOW_DAYS = 90;
let telemetryTimer: ReturnType<typeof setInterval> | null = null;

async function aggregate(): Promise<{
  teams: number;
  members: number;
  projects: number;
  files: number;
}> {
  if (!prisma) throw new Error("database unavailable");

  const active = { OR: [{ isDeleted: false }, { isDeleted: null }] };
  const [teams, members, projects, diagrams, notes, drawings, flowcharts] = await Promise.all([
    prisma.team.count({ where: { status: "active" } }),
    prisma.teamMember.count({ where: { status: "active" } }),
    prisma.project.count({ where: active }),
    prisma.diagram.count({ where: active }),
    prisma.note.count({ where: active }),
    prisma.drawing.count({ where: active }),
    prisma.flowchart.count({ where: active }),
  ]);

  return { teams, members, projects, files: diagrams + notes + drawings + flowcharts };
}

async function aggregateAiUsage(reportedAt: string): Promise<Array<{
  organization_id: string;
  period_start: string;
  period_end: string | null;
  credits_used: number;
  requests_succeeded: number;
  requests_failed: number;
  source_revision: string;
  reported_at: string;
}>> {
  if (!prisma) throw new Error("database unavailable");

  const cutoff = new Date(Date.now() - CLOUD_AI_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const postgres = isPostgresDatabase();
  const rows = await prisma.$queryRawUnsafe<Array<{
    organization_id: string;
    period_start: Date | string;
    period_end: Date | string | null;
    credits_used: number;
    requests_succeeded: number;
    requests_failed: number;
    source_revision: string;
  }>>(`
    SELECT teams."sso_organization_id" AS organization_id,
           periods."period_start" AS period_start,
           periods."period_end" AS period_end,
           periods."consumed_credits" AS credits_used,
           COALESCE(SUM(CASE WHEN requests."state" = 'consumed' AND requests."error_code" IS NULL THEN 1 ELSE 0 END), 0) AS requests_succeeded,
           COALESCE(SUM(CASE WHEN requests."state" IN ('released', 'rejected') OR requests."error_code" IS NOT NULL THEN 1 ELSE 0 END), 0) AS requests_failed,
           periods."entitlement_revision" AS source_revision
      FROM "cloud_ai_usage_periods" AS periods
      JOIN "teams" AS teams ON teams."id" = periods."team_id" AND teams."sso_organization_id" IS NOT NULL
      LEFT JOIN "cloud_ai_usage_requests" AS requests ON requests."period_id" = periods."id"
     WHERE periods."period_start" >= ${postgres ? "$1" : "?"}
     GROUP BY teams."sso_organization_id", periods."period_start", periods."period_end", periods."consumed_credits", periods."entitlement_revision"
     ORDER BY periods."period_start" DESC`, postgres ? cutoff : cutoff.toISOString());

  return rows.map((row) => ({
    organization_id: row.organization_id,
    period_start: new Date(String(row.period_start)).toISOString(),
    period_end: row.period_end ? new Date(String(row.period_end)).toISOString() : null,
    credits_used: Number(row.credits_used),
    requests_succeeded: Number(row.requests_succeeded),
    requests_failed: Number(row.requests_failed),
    source_revision: row.source_revision,
    reported_at: reportedAt,
  }));
}

type StorageUsageReport = {
  organization_id: string;
  document_bytes: number;
  asset_bytes: number;
  unused_asset_bytes: number;
  revision_bytes: number;
  files: { diagrams: number; notes: number; drawings: number; flowcharts: number };
  reported_at: string;
};

/**
 * Aggregate storage per Team organization (CLD-010 Tahap 0): byte totals and file counts only, never content or keys.
 * Asset bytes follow the quota rule: objects unreferenced for seven days or more no longer count.
 */
export async function aggregateStorageUsage(reportedAt: string): Promise<StorageUsageReport[]> {
  if (!prisma || !isPostgresDatabase()) return [];
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t."sso_organization_id" AS organization_id,
           COALESCE(u."document_bytes", 0) AS document_bytes,
           COALESCE(u."revision_bytes", 0) AS revision_bytes,
           COALESCE((SELECT SUM(o."bytes") FROM "storage_objects" o WHERE o."scope_type" = 'team' AND o."scope_id" = t."id"
             AND o."status" IN ('pending', 'committed') AND (o."unreferenced_since" IS NULL OR o."unreferenced_since" > NOW() - INTERVAL '7 days')), 0) AS asset_bytes,
           COALESCE((SELECT SUM(o."bytes") FROM "storage_objects" o WHERE o."scope_type" = 'team' AND o."scope_id" = t."id"
             AND o."status" = 'committed' AND o."unreferenced_since" IS NOT NULL), 0) AS unused_asset_bytes,
           (SELECT COUNT(*) FROM "diagrams" f JOIN "projects" p ON p."id" = f."project_id" WHERE p."team_id" = t."id") AS diagrams,
           (SELECT COUNT(*) FROM "notes" f JOIN "projects" p ON p."id" = f."project_id" WHERE p."team_id" = t."id") AS notes,
           (SELECT COUNT(*) FROM "drawings" f JOIN "projects" p ON p."id" = f."project_id" WHERE p."team_id" = t."id") AS drawings,
           (SELECT COUNT(*) FROM "flowcharts" f JOIN "projects" p ON p."id" = f."project_id" WHERE p."team_id" = t."id") AS flowcharts
      FROM "teams" t
      LEFT JOIN "storage_usage" u ON u."scope_type" = 'team' AND u."scope_id" = t."id"
     WHERE t."sso_organization_id" IS NOT NULL`);
  return rows.map((row) => ({
    organization_id: String(row.organization_id),
    document_bytes: Number(row.document_bytes),
    asset_bytes: Number(row.asset_bytes),
    unused_asset_bytes: Number(row.unused_asset_bytes),
    revision_bytes: Number(row.revision_bytes),
    files: { diagrams: Number(row.diagrams), notes: Number(row.notes), drawings: Number(row.drawings), flowcharts: Number(row.flowcharts) },
    reported_at: reportedAt,
  }));
}

export async function sendCloudTelemetryHeartbeat(): Promise<boolean> {
  if (!isSsoAuthMode() || !prisma) return false;

  const config = getCloudTelemetryConfig();
  if (!config.issuerUrl || !config.clientId || !config.clientSecret || !config.deploymentId) return false;

  try {
    const token = await getCloudMachineToken(config, "cloud:telemetry");
    const observedAt = new Date().toISOString();
    const aggregateSnapshot = await aggregate();
    const aiUsage = await aggregateAiUsage(observedAt);
    const storageUsage = await aggregateStorageUsage(observedAt).catch(() => [] as StorageUsageReport[]);
    const storageBytes = storageUsage.reduce((sum, report) => sum + report.document_bytes + report.asset_bytes, 0);
    const batchCount = Math.max(1, Math.ceil(aiUsage.length / 100), Math.ceil(storageUsage.length / 100));
    const batches = Array.from({ length: batchCount }, (_, index) => ({
      ai: aiUsage.slice(index * 100, index * 100 + 100),
      storage: storageUsage.slice(index * 100, index * 100 + 100),
    }));
    const url = new URL("/api/v1/cloud/telemetry/heartbeat", config.issuerUrl).toString();
    for (const batch of batches) {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          deployment_id: config.deploymentId,
          ...(config.tenantRef ? { tenant_ref: config.tenantRef } : {}),
          observed_at: observedAt,
          version: config.version,
          status: "ready",
          aggregate: { ...aggregateSnapshot, storage_bytes: storageBytes },
          ai_usage: batch.ai,
          storage_usage: batch.storage,
          error_codes: [],
        }),
      });

      if (!response.ok) throw new Error("telemetry heartbeat failed with HTTP " + response.status);
    }
    return true;
  } catch (error) {
    logger.warn({ reason: error instanceof Error ? error.message : "unknown error" }, "Cloud telemetry heartbeat failed");
    return false;
  }
}

export function startCloudTelemetry(): void {
  if (!isSsoAuthMode() || telemetryTimer) return;
  void sendCloudTelemetryHeartbeat();
  telemetryTimer = setInterval(() => { void sendCloudTelemetryHeartbeat(); }, CLOUD_TELEMETRY_INTERVAL_MS);
  telemetryTimer.unref?.();
}
