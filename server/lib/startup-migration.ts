import { prisma } from "./prisma.js";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { isDesktopMode, isLocalPostgres } from "./config.js";
import { migrateDbClients } from "./db-client-migration.js";
import { addColumnIfMissing, ensureColumnType, isPostgresDatabase, postgresDateType } from "./startup-schema-migration.js";
import { createTeamTablesIfMissing, migrateLegacyDiscussionTablesIfNeeded, backfillLegacyTeamData, sealExistingTeamRecords } from "./startup-team-migration.js";
import { ensureFileAccessColumns, backfillLegacyFileOwners, createErdMetadataTablesIfMissing, normalizeLegacyColumnIds } from "./startup-file-migration.js";
import { ensureRepositoryLinkColumns, createDbConnectTablesIfMissing, createSqlQueriesTableIfMissing } from "./startup-local-migration.js";

export { ensureRepositoryLinkColumns };
export type { ColumnInfo } from "./startup-schema-migration.js";

type PrismaRecord = { id: number | bigint | string };

async function backfillModelUids<T extends PrismaRecord>(
  name: string,
  findMany: () => Promise<T[]>,
  updateOne: (id: T["id"], uid: string) => Promise<unknown>,
): Promise<void> {
  const records = await findMany();
  if (records.length === 0) return;

  for (const record of records) {
    await updateOne(record.id, randomUUID());
  }
  logger.info({ count: records.length, model: name }, "Backfilled uids");
}

/**
 * Backfills `uid` for existing records that have a null uid.
 * Required for SQLite where @default(dbgenerated("gen_random_uuid()"))
 * is not available — only PostgreSQL supports that.
 */
export async function backfillUids(): Promise<void> {
  if (!prisma) return;

  try {
    await backfillModelUids(
      "project",
      () => prisma!.project.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.project.update({ where: { id: id as never }, data: { uid } }),
    );
    await backfillModelUids(
      "diagram",
      () => prisma!.diagram.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.diagram.update({ where: { id: id as never }, data: { uid } }),
    );
    await backfillModelUids(
      "note",
      () => prisma!.note.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.note.update({ where: { id: id as never }, data: { uid } }),
    );
    await backfillModelUids(
      "drawing",
      () => prisma!.drawing.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.drawing.update({ where: { id: id as never }, data: { uid } }),
    );
    await backfillModelUids(
      "flowchart",
      () => prisma!.flowchart.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.flowchart.update({ where: { id: id as never }, data: { uid } }),
    );
    await backfillModelUids(
      "aiChatSession",
      () => prisma!.aiChatSession.findMany({ where: { uid: null }, select: { id: true } }),
      (id, uid) => prisma!.aiChatSession.update({ where: { id: id as never }, data: { uid } }),
    );
    if (isDesktopMode()) {
      await backfillModelUids(
        "sqlQuery",
        () => (prisma as any).sqlQuery.findMany({ where: { uid: null }, select: { id: true } }),
        (id, uid) => (prisma as any).sqlQuery.update({ where: { id: id as never }, data: { uid } }),
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to backfill uids");
  }
}

async function ensureAiChatMessageIdempotency(): Promise<void> {
  if (!prisma) return;
  await addColumnIfMissing("ai_chat_messages", "client_message_id", '"client_message_id" VARCHAR(64)');
  await addColumnIfMissing("ai_chat_messages", "is_trusted_assistant", '"is_trusted_assistant" BOOLEAN NOT NULL DEFAULT false');
  try {
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ai_chat_messages_session_id_client_message_id_key" ON "ai_chat_messages"("session_id", "client_message_id")',
    );
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to create AI chat idempotency index (non-fatal)");
  }
}

/**
 * Apply incremental schema changes for columns added in newer app versions.
 * Called once at startup alongside backfillUids.
 *
 * How to add a new column (always safe):
 *   await addColumnIfMissing("backups", "destinations", "destinations TEXT");
 *
 * How to change a column TYPE (table rebuild, SQLite only):
 *   await ensureColumnType("backups", "destinations", "INTEGER", "CAST(destinations AS INTEGER)");
 *   //                 table ──┘    column ───────┘      new type ────┘   cast expression ────────────────────────┘
 *   // castExpr is optional — omit if existing data is compatible (e.g. TEXT→VARCHAR)
 */
export async function applySchemaMigrations(): Promise<void> {
  // Additive startup self-heal for installed SQLite and PostgreSQL deployments.
  if (!prisma || (!isDesktopMode() && !isPostgresDatabase())) return;

  await addColumnIfMissing("users", "must_change_password", '"must_change_password" BOOLEAN NOT NULL DEFAULT false');
  await addColumnIfMissing("users", "sso_subject", '"sso_subject" TEXT');
  await addColumnIfMissing("users", "sso_email", '"sso_email" TEXT');
  if (isDesktopMode() || isLocalPostgres()) {
    await addColumnIfMissing("users", "login_failed_attempts", '"login_failed_attempts" INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(
      "users",
      "login_locked_until",
      `"login_locked_until" ${isLocalPostgres() ? postgresDateType() : "DATETIME"}`,
    );
  }
  try {
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "users_sso_subject_key" ON "users"("sso_subject")');
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to enforce SSO subject uniqueness (non-fatal)");
  }
  try {
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_key" ON "users"(LOWER("email"))');
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to enforce case-insensitive user email uniqueness (non-fatal)");
  }

  // v2.4+ — destinations column on backups table
  await addColumnIfMissing("backups", "destinations", "destinations TEXT");
  await addColumnIfMissing("user_preferences", "auto_backup_enabled", '"auto_backup_enabled" BOOLEAN DEFAULT false');
  await addColumnIfMissing("user_preferences", "auto_backup_interval", '"auto_backup_interval" INTEGER DEFAULT 3600');
  await addColumnIfMissing("user_preferences", "auto_backup_retention", '"auto_backup_retention" INTEGER DEFAULT 10');
  await addColumnIfMissing("user_preferences", "storage_config", '"storage_config" TEXT');

  // v3.1.4+ — persist DBML source alongside ERD canvas data
  await addColumnIfMissing("diagrams", "dbml_source", '"dbml_source" TEXT');
  await addColumnIfMissing("diagrams", "source_type", '"source_type" TEXT DEFAULT \'blank\'');
  await addColumnIfMissing("diagrams", "source_connection_id", '"source_connection_id" INTEGER');
  await addColumnIfMissing("diagrams", "data", '"data" TEXT');

  // v3.2+ — ERD column comments and type modifier metadata.
  await addColumnIfMissing("columns", "comment", '"comment" TEXT');
  await addColumnIfMissing("columns", "max_length", '"max_length" INTEGER');
  await addColumnIfMissing("columns", "numeric_precision", '"numeric_precision" INTEGER');
  await addColumnIfMissing("columns", "numeric_scale", '"numeric_scale" INTEGER');
  await addColumnIfMissing("columns", "default_value", '"default_value" TEXT');
  await addColumnIfMissing("columns", "is_unique", '"is_unique" BOOLEAN DEFAULT false');
  await addColumnIfMissing("entities", "comment", '"comment" TEXT');
  await addColumnIfMissing("relationships", "on_delete", '"on_delete" TEXT');
  await addColumnIfMissing("relationships", "on_update", '"on_update" TEXT');
  await addColumnIfMissing("relationships", "constraint_name", '"constraint_name" TEXT');
  await ensureFileAccessColumns();
  await ensureAiChatMessageIdempotency();
  await createErdMetadataTablesIfMissing();
  await createTeamTablesIfMissing();
  await migrateLegacyDiscussionTablesIfNeeded();
  await backfillLegacyTeamData();
  await backfillLegacyFileOwners();
  await sealExistingTeamRecords();
  if (isDesktopMode()) {
    // v3.4.3+ — local Repository-Aware ERD link used by Desktop/CLI MCP.
    await ensureRepositoryLinkColumns();
    await createDbConnectTablesIfMissing();
    await createSqlQueriesTableIfMissing();
    await migrateDbClients();
    await addColumnIfMissing("db_accounts", "environment", '"environment" TEXT NOT NULL DEFAULT \'development\'');
    await addColumnIfMissing("db_accounts", "safe_mode", '"safe_mode" TEXT NOT NULL DEFAULT \'protected\'');
    await addColumnIfMissing("db_accounts", "ssl_mode", '"ssl_mode" TEXT NOT NULL DEFAULT \'disable\'');
    await addColumnIfMissing("db_accounts", "ssl_ca", '"ssl_ca" TEXT');
    await addColumnIfMissing("db_accounts", "ssl_cert", '"ssl_cert" TEXT');
    await addColumnIfMissing("db_accounts", "ssl_key", '"ssl_key" TEXT');
    await addColumnIfMissing("db_accounts", "query_timeout_ms", '"query_timeout_ms" INTEGER NOT NULL DEFAULT 30000');
  }

  // v3.1.4+ — normalize old random column ids and keep relationships wired.
  if (isDesktopMode()) await normalizeLegacyColumnIds();
}
