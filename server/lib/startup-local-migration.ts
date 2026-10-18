import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { isDesktopMode } from "./config.js";
import { addColumnIfMissing, getColumns } from "./startup-schema-migration.js";

export async function ensureRepositoryLinkColumns(): Promise<void> {
  if (!prisma || !isDesktopMode()) return;
  await addColumnIfMissing("diagrams", "repository_path", '"repository_path" TEXT');
  await addColumnIfMissing("diagrams", "repository_ref", '"repository_ref" TEXT');
  await addColumnIfMissing("diagrams", "repository_source_id", '"repository_source_id" TEXT');
}

export async function createSqlQueriesTableIfMissing(): Promise<void> {
  if (!prisma || !isDesktopMode()) return;
  try {
    const cols = await getColumns("sql_queries");
    if (cols.length > 0) return;
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "sql_queries" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "uid" TEXT UNIQUE,
        "diagram_id" INTEGER NOT NULL,
        "group_name" TEXT NOT NULL DEFAULT 'Ungrouped',
        "name" TEXT NOT NULL,
        "script" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "sql_queries_diagram_id_fkey" FOREIGN KEY ("diagram_id") REFERENCES "diagrams" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_sql_queries_diagram" ON "sql_queries"("diagram_id")`);
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to create sql_queries table (non-fatal)");
  }
}

export async function createDbConnectTablesIfMissing(): Promise<void> {
  if (!prisma || !isDesktopMode()) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "db_accounts" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "user_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "host" TEXT,
        "port" INTEGER,
        "user" TEXT,
        "password" TEXT,
        "environment" TEXT NOT NULL DEFAULT 'development',
        "safe_mode" TEXT NOT NULL DEFAULT 'protected',
        "ssl_mode" TEXT NOT NULL DEFAULT 'disable',
        "ssl_ca" TEXT,
        "ssl_cert" TEXT,
        "ssl_key" TEXT,
        "query_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "db_catalogs" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "account_id" INTEGER NOT NULL,
        "database_name" TEXT NOT NULL,
        "label" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "db_catalogs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "db_accounts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_db_accounts_user" ON "db_accounts"("user_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_db_catalogs_account" ON "db_catalogs"("account_id")`);
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to create DB Connect tables (non-fatal)");
  }
}
