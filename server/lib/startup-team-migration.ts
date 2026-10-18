import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { isDesktopMode, isLocalPostgres, isSsoAuthMode } from "./config.js";
import { claimTeamProvisioningBaseline, hasTeamProvisioningBaseline } from "./installation-identity.js";
import { isProvisionedTeam, isProvisionedMembership, membershipProvisioningSignature, teamProvisioningSignature } from "./team-provisioning.js";
import { addColumnIfMissing, getColumns, postgresDateType } from "./startup-schema-migration.js";

export async function createTeamTablesIfMissing(): Promise<void> {
  if (!prisma || (!isDesktopMode() && !isLocalPostgres())) return;

  await addColumnIfMissing("users", "cloud_personal_entitlement", '"cloud_personal_entitlement" TEXT');
  await addColumnIfMissing("projects", "team_id", '"team_id" TEXT');

  try {
    const dateType = isLocalPostgres() ? postgresDateType() : "DATETIME";
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'team',
        "created_by" TEXT,
        "sso_organization_id" TEXT,
        "status" TEXT NOT NULL DEFAULT 'active',
        "cloud_entitlement" TEXT,
        "provisioning_signature" TEXT,
        "created_at" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await addColumnIfMissing("teams", "type", '"type" TEXT NOT NULL DEFAULT \'team\'');
    await addColumnIfMissing("teams", "created_by", '"created_by" TEXT');
    await addColumnIfMissing("teams", "sso_organization_id", '"sso_organization_id" TEXT');
    await addColumnIfMissing("teams", "status", '"status" TEXT NOT NULL DEFAULT \'active\'');
    await addColumnIfMissing("teams", "cloud_entitlement", '"cloud_entitlement" TEXT');
    await addColumnIfMissing("teams", "provisioning_signature", '"provisioning_signature" TEXT');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "team_members" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "team_id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'staff',
        "status" TEXT NOT NULL DEFAULT 'active',
        "joined_at" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "provisioning_signature" TEXT,
        CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await addColumnIfMissing("team_members", "provisioning_signature", '"provisioning_signature" TEXT');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "team_invitations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "team_id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "token_hash" TEXT NOT NULL UNIQUE,
        "expires_at" ${dateType} NOT NULL,
        "accepted_at" ${dateType},
        "created_at" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "team_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "team_audit_events" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "team_id" TEXT,
        "actor_id" TEXT,
        "action" TEXT NOT NULL,
        "target_type" TEXT,
        "target_id" TEXT,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "team_audit_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "team_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_user_key" ON "team_members"("team_id", "user_id")');
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "teams_sso_organization_id_key" ON "teams"("sso_organization_id")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_team_members_user_status" ON "team_members"("user_id", "status")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_team_invitations_team_expires" ON "team_invitations"("team_id", "expires_at")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_team_invitations_email_accepted" ON "team_invitations"("email", "accepted_at")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_team_audit_events_team_created" ON "team_audit_events"("team_id", "created_at")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_team_audit_events_actor_created" ON "team_audit_events"("actor_id", "created_at")');
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "team_audit_cloud_event_key" ON "team_audit_events"("target_type", "target_id") WHERE "target_type" = \'cloud_event\'');
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "team_members_one_active_user_key"');
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to create Team tables (non-fatal)");
  }
}

const LEGACY_DISCUSSION_TABLES = [
  ["cloud_erd_discussion_threads", "discussion_threads"],
  ["cloud_erd_discussion_messages", "discussion_messages"],
  ["cloud_erd_discussion_reads", "discussion_reads"],
] as const;

export async function migrateLegacyDiscussionTablesIfNeeded(): Promise<void> {
  if (!prisma) return;
  const [legacyThreads, legacyMessages, legacyReads] = LEGACY_DISCUSSION_TABLES;
  if ((await getColumns(legacyThreads[0])).length === 0) return;
  if ((await getColumns("discussion_threads")).length === 0 || (await getColumns("discussion_contexts")).length === 0) {
    logger.warn("Discussion migration is missing Prisma-owned tables; legacy data was left untouched");
    return;
  }

  try {
    const threads = await prisma.$queryRawUnsafe<Array<{
      id: string; diagram_id: number | bigint; team_id: string;
      status: string; created_by: string;
      resolved_by: string | null; created_at: Date | string; updated_at: Date | string;
    }>>(`SELECT "id", "diagram_id", "team_id", "status", "created_by", "resolved_by", "created_at", "updated_at" FROM "${legacyThreads[0]}"`);
    for (const thread of threads) {
      const project = await prisma.$queryRawUnsafe<Array<{ id: number | bigint }>>(
        'SELECT p."id" FROM "diagrams" d LEFT JOIN "projects" p ON p."id" = d."project_id" WHERE d."id" = $1 LIMIT 1',
        thread.diagram_id,
      );
      await prisma.$executeRawUnsafe(`
        INSERT INTO "discussion_threads" ("id", "project_id", "team_id", "status", "created_by", "resolved_by", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT ("id") DO NOTHING
      `, thread.id, project[0]?.id ?? null, thread.team_id, thread.status, thread.created_by, thread.resolved_by, thread.created_at, thread.updated_at);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "discussion_contexts" ("id", "thread_id", "feature_type", "file_id", "created_at")
        VALUES ($1, $2, 'diagram', $3, $4)
        ON CONFLICT ("id") DO NOTHING
      `, `${thread.id}:diagram:${String(thread.diagram_id)}`, thread.id, String(thread.diagram_id), thread.created_at);
    }

    if ((await getColumns(legacyMessages[0])).length > 0) {
      const messages = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id", "thread_id", "author_id", "author_name", "body", "created_at" FROM "${legacyMessages[0]}"`);
      for (const message of messages) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "discussion_messages" ("id", "thread_id", "author_id", "author_name", "body", "created_at")
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT ("id") DO NOTHING
        `, message.id, message.thread_id, message.author_id, message.author_name, message.body, message.created_at);
      }
    }

    if ((await getColumns(legacyReads[0])).length > 0) {
      const reads = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "thread_id", "user_id", "last_read_at" FROM "${legacyReads[0]}"`);
      for (const read of reads) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "discussion_reads" ("thread_id", "user_id", "last_read_at")
          VALUES ($1, $2, $3)
          ON CONFLICT ("thread_id", "user_id") DO NOTHING
        `, read.thread_id, read.user_id, read.last_read_at);
      }
    }
    logger.info({ count: threads.length }, "Migrated legacy discussion data to Project contexts");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to migrate legacy discussion data (non-fatal)");
  }
}

/** Establishes the signed baseline once for Teams that existed before this release. */
export async function sealExistingTeamRecords(): Promise<void> {
  if (!prisma || !isLocalPostgres() || isSsoAuthMode() || hasTeamProvisioningBaseline()) return;
  const { teamCount, memberCount } = await prisma.$transaction(async (tx) => {
    const teams = await tx.$queryRawUnsafe<Array<{ id: string; status: string; created_at: Date | string; cloud_entitlement: string | null }>>(
      'SELECT "id", "status", "created_at", "cloud_entitlement" FROM "teams" WHERE "provisioning_signature" IS NULL',
    );
    for (const team of teams) {
      const createdAt = new Date(team.created_at);
      const signature = teamProvisioningSignature({ id: team.id, status: team.status, createdAt, cloudEntitlement: team.cloud_entitlement });
      await tx.$executeRawUnsafe(
        `UPDATE "teams" SET "provisioning_signature" = ${sqlLiteral(signature)} WHERE "id" = ${sqlLiteral(team.id)} AND "provisioning_signature" IS NULL`,
      );
    }

    const members = await tx.$queryRawUnsafe<Array<{
      id: string; team_id: string; user_id: string; role: string; status: string; joined_at: Date | string; provisioning_signature: string | null;
    }>>('SELECT "id", "team_id", "user_id", "role", "status", "joined_at", "provisioning_signature" FROM "team_members"');
    for (const member of members) {
      const joinedAt = new Date(member.joined_at);
      const signatureValid = isProvisionedMembership({
        id: member.id, teamId: member.team_id, userId: member.user_id, role: member.role, status: member.status, joinedAt, provisioningSignature: member.provisioning_signature,
      });
      const role = member.role === "member" ? "staff" : member.role;
      if (member.provisioning_signature && !(member.role === "member" && signatureValid)) {
        if (role !== member.role) {
          await tx.$executeRawUnsafe(
            `UPDATE "team_members" SET "role" = 'staff' WHERE "id" = ${sqlLiteral(member.id)} AND "role" = 'member'`,
          );
        }
        continue;
      }
      const signature = membershipProvisioningSignature({
        id: member.id, teamId: member.team_id, userId: member.user_id, role, status: member.status, joinedAt,
      });
      await tx.$executeRawUnsafe(
        `UPDATE "team_members" SET "role" = ${sqlLiteral(role)}, "provisioning_signature" = ${sqlLiteral(signature)} WHERE "id" = ${sqlLiteral(member.id)}`,
      );
    }
    return { teamCount: teams.length, memberCount: members.length };
  });
  claimTeamProvisioningBaseline();
  if (teamCount || memberCount) logger.info({ teams: teamCount, members: memberCount }, "Established Team provisioning baseline");
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}

type LegacyUser = { id: string; email: string | null; name: string | null; is_super_admin: boolean | number | null };
type LegacyProject = { id: number; user_id: string | null; team_id: string | null };
type LegacyTeam = { id: string; type: string | null; status: string | null };

async function recordLegacyRecovery(projectId: number, reason: string): Promise<void> {
  if (!prisma) return;
  const targetId = String(projectId);
  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "team_audit_events"
     WHERE "action" = 'legacy_recovery_required'
       AND "target_type" = 'project'
       AND "target_id" = ${sqlLiteral(targetId)}
     LIMIT 1`,
  );
  if (existing.length > 0) return;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "team_audit_events"
      ("id", "action", "target_type", "target_id", "metadata")
     VALUES (${sqlLiteral(randomUUID())}, 'legacy_recovery_required', 'project', ${sqlLiteral(targetId)}, ${sqlLiteral(JSON.stringify({ reason }))})`,
  );
}

export async function backfillLegacyTeamData(): Promise<void> {
  if (!prisma || !isLocalPostgres() || isSsoAuthMode()) return;
  const baseline = hasTeamProvisioningBaseline();
  const configuredTeamId = process.env.ERDBPRO_LEGACY_TEAM_ID?.trim();
  if (baseline && !configuredTeamId) return;

  try {
    const pendingOnly = baseline ? ` AND EXISTS (
      SELECT 1 FROM "team_audit_events" audit WHERE audit."action" = 'legacy_recovery_required'
        AND audit."target_type" = 'project' AND audit."target_id" = CAST("projects"."id" AS TEXT)
    )` : "";
    const [users, teams, projects, memberships] = await Promise.all([
      prisma.$queryRawUnsafe<LegacyUser[]>(`SELECT "id", "email", "name", "is_super_admin" FROM "users"`),
      prisma.$queryRawUnsafe<Array<LegacyTeam & { created_at: Date; cloud_entitlement: string | null; provisioning_signature: string | null }>>(
        `SELECT "id", "type", "status", "created_at", "cloud_entitlement", "provisioning_signature" FROM "teams"`),
      prisma.$queryRawUnsafe<LegacyProject[]>(`SELECT "id", "user_id", "team_id" FROM "projects" WHERE "team_id" IS NULL${pendingOnly}`),
      prisma.$queryRawUnsafe<Array<{ id: string; user_id: string; team_id: string; role: string; status: string; joined_at: Date; provisioning_signature: string | null }>>(
        `SELECT "id", "user_id", "team_id", "role", "status", "joined_at", "provisioning_signature" FROM "team_members"`),
    ]);
    if (projects.length === 0) return;
    const userById = new Map(users.map(user => [user.id, user]));
    const candidateTeams = teams.filter(team => team.status === "active" && team.type !== "personal"
      && ((!baseline && !team.provisioning_signature) || isProvisionedTeam({ id: team.id, status: team.status!, createdAt: new Date(team.created_at),
        cloudEntitlement: team.cloud_entitlement, provisioningSignature: team.provisioning_signature })));
    const validMembership = (member: typeof memberships[number]) => (!baseline && !member.provisioning_signature)
      || isProvisionedMembership({ id: member.id, teamId: member.team_id, userId: member.user_id, role: member.role,
        status: member.status, joinedAt: new Date(member.joined_at), provisioningSignature: member.provisioning_signature });
    let assigned = 0;
    for (const project of projects) {
      const user = project.user_id ? userById.get(project.user_id) : undefined;
      if (!user) {
        await recordLegacyRecovery(project.id, project.user_id ? "owner_not_found" : "missing_owner");
        continue;
      }
      if (Boolean(user.is_super_admin)) continue;
      const activeTeams = memberships.filter(member => member.user_id === user.id && member.status === "active"
        && validMembership(member) && candidateTeams.some(team => team.id === member.team_id));
      const targetTeamId = configuredTeamId
        ? candidateTeams.find(team => team.id === configuredTeamId)?.id
        : undefined;
      if (!targetTeamId) {
        await recordLegacyRecovery(project.id, configuredTeamId ? "configured_team_unavailable"
          : activeTeams.length > 1 ? "ambiguous_team_membership" : "initial_team_selection_required");
        continue;
      }
      const existing = memberships.find(member => member.user_id === user.id && member.team_id === targetTeamId);
      if (existing && (existing.status !== "active" || !validMembership(existing))) {
        await recordLegacyRecovery(project.id, "membership_recovery_required");
        continue;
      }
      if (!existing) {
        const member = { id: randomUUID(), teamId: targetTeamId, userId: user.id, role: "staff", status: "active", joinedAt: new Date() };
        const signature = membershipProvisioningSignature(member);
        await (prisma as any).teamMember.create({ data: { ...member, provisioningSignature: signature } });
        memberships.push({ id: member.id, team_id: targetTeamId, user_id: user.id, role: member.role, status: member.status,
          joined_at: member.joinedAt, provisioning_signature: signature });
      }
      await prisma.$executeRawUnsafe(`UPDATE "projects" SET "team_id" = ${sqlLiteral(targetTeamId)}
        WHERE "id" = ${sqlLiteral(project.id)} AND "team_id" IS NULL`);
      assigned++;
    }
    if (assigned) logger.info({ assigned }, "Backfilled legacy projects into Team scope");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to backfill legacy Team data (non-fatal)");
  }
}
