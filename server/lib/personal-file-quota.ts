import { isSsoAuthMode } from "./config.js";
import { parseCloudEntitlement, parseStoredCloudEntitlement } from "./cloud-entitlement.js";
import { assertStorageAvailable } from "./storage-usage.js";
import { prisma } from "./prisma.js";
import { currentTeamScope, fileScopeWhere } from "./team-scope.js";

export type PersonalFileFeature = "diagrams" | "notes" | "drawings" | "flowcharts";

const DEFAULT_PERSONAL_FILE_LIMIT = 3;

const featureLabels: Record<PersonalFileFeature, string> = {
  diagrams: "ERD Builder",
  notes: "Notes",
  drawings: "Drawings",
  flowcharts: "Flowcharts",
};

/** Hidden per-Team ceiling on files of all features, a platform guard rather than a plan field (CLD-010 Q11). */
const TEAM_FILE_CEILING = Number(process.env.CLOUD_TEAM_FILE_CEILING) || 10_000;

export class TeamFileQuotaError extends Error {
  readonly code = "TEAM_FILE_QUOTA_EXCEEDED";
  readonly status = 409;

  constructor(readonly feature: PersonalFileFeature, readonly limit: number, perFeature: boolean) {
    super(perFeature
      ? `This Team has reached the limit of ${limit} ${featureLabels[feature]} files for its plan.`
      : `This Team has reached the limit of ${limit} files. Contact support to raise it.`);
    this.name = "TeamFileQuotaError";
  }
}

export class PersonalFileQuotaError extends Error {
  readonly code = "PERSONAL_FILE_QUOTA_EXCEEDED";
  readonly status = 409;

  constructor(readonly feature: PersonalFileFeature, readonly limit: number) {
    super(`Personal Workspace has reached the limit of ${limit} ${featureLabels[feature]} files.`);
    this.name = "PersonalFileQuotaError";
  }
}

function storedPersonalLimit(value: unknown): number | null | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value);
    const entitlement = parseCloudEntitlement({ ...parsed, status: "active" }, "active");
    return entitlement?.limits.max_personal_files_per_feature;
  } catch {
    return undefined;
  }
}

async function personalFileLimit(db: any, userId: string): Promise<number | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { cloudPersonalEntitlement: true },
  });
  const storedLimit = storedPersonalLimit(user?.cloudPersonalEntitlement);
  return storedLimit === undefined ? DEFAULT_PERSONAL_FILE_LIMIT : storedLimit;
}

async function assertPersonalFileQuota(db: any, feature: PersonalFileFeature, userId: string): Promise<void> {
  if (!isSsoAuthMode() || currentTeamScope()?.mode !== "personal") return;

  const where: any = { AND: [fileScopeWhere(userId)] };
  if (feature === "diagrams") {
    where.AND.push({ OR: [{ sourceType: null }, { sourceType: { not: "production_db" } }] });
  }

  const limit = await personalFileLimit(db, userId);
  if (limit === null) return;

  const count = await db[feature.slice(0, -1)].count({ where });
  if (count >= limit) throw new PersonalFileQuotaError(feature, limit);
}

function featureWhere(feature: PersonalFileFeature, scope: Record<string, unknown>) {
  const where: any = { AND: [scope] };
  if (feature === "diagrams") where.AND.push({ OR: [{ sourceType: null }, { sourceType: { not: "production_db" } }] });
  return where;
}

/** Trial Teams have a per-feature file limit; every Team has the hidden total ceiling. Trash counts (CLD-010 Q3). */
async function assertTeamFileQuota(db: any, feature: PersonalFileFeature, teamId: string, perFeatureLimit: number | null) {
  const inTeam = { project: { teamId } };
  if (perFeatureLimit !== null && await db[feature.slice(0, -1)].count({ where: featureWhere(feature, inTeam) }) >= perFeatureLimit) {
    throw new TeamFileQuotaError(feature, perFeatureLimit, true);
  }
  const counts = await Promise.all(["diagram", "note", "drawing", "flowchart"].map((model) => db[model].count({ where: inTeam })));
  if (counts.reduce((sum, count) => sum + count, 0) >= TEAM_FILE_CEILING) throw new TeamFileQuotaError(feature, TEAM_FILE_CEILING, false);
}

/**
 * Creates a file under the Cloud quotas of the active scope: Personal files per feature, Trial Team files per feature,
 * the hidden Team ceiling, and refusal once the scope's storage is full. Self-host and Desktop create directly.
 */
export async function createPersonalFile<T>(
  feature: PersonalFileFeature,
  userId: string,
  create: (db: any) => Promise<T>,
): Promise<T> {
  if (!prisma) throw new Error("Database connection not available");
  const scope = currentTeamScope();
  if (!isSsoAuthMode() || !scope) {
    return create(prisma);
  }

  if (scope.mode === "team" && scope.teamId) {
    const teamId = scope.teamId;
    const team = await (prisma as any).team.findUnique({ where: { id: teamId }, select: { cloudEntitlement: true } });
    const perFeatureLimit = parseStoredCloudEntitlement(team?.cloudEntitlement)?.limits.max_team_files_per_feature ?? null;
    return prisma.$transaction(async (db: any) => {
      await assertTeamFileQuota(db, feature, teamId, perFeatureLimit);
      await assertStorageAvailable(db, { type: "team", id: teamId });
      return create(db);
    }, { isolationLevel: "Serializable" });
  }

  return prisma.$transaction(async (db: any) => {
    await assertPersonalFileQuota(db, feature, userId);
    await assertStorageAvailable(db, { type: "user", id: userId });
    return create(db);
  }, { isolationLevel: "Serializable" });
}
