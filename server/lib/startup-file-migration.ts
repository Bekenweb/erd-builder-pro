import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { isLocalPostgres } from "./config.js";
import { isUuid, replaceColumnIdInHandle } from "./erd-column-id-migration.js";
import { addColumnIfMissing, isPostgresDatabase, postgresDateType } from "./startup-schema-migration.js";

const SHAREABLE_FILE_TABLES = ["diagrams", "notes", "drawings", "flowcharts"] as const;

async function backfillLegacyFileAccess(table: string): Promise<void> {
  if (!prisma) return;

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}"
       SET "public_access" = 'read_only'
       WHERE "public_access" = 'off' AND COALESCE("is_public", false) = true`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}"
       SET "share_expires_at" = "expiry_date"
       WHERE "share_expires_at" IS NULL AND "expiry_date" IS NOT NULL`,
    );

    const rows = await prisma.$queryRawUnsafe<{ id: number | bigint | string; token: string }[]>(
      `SELECT "id", "share_token" AS "token"
       FROM "${table}"
       WHERE "share_token" IS NOT NULL
         AND "share_token" <> ''
         AND "share_token_hash" IS NULL`,
    );

    for (const row of rows) {
      const hash = createHash("sha256").update(String(row.token), "utf8").digest("hex");
      if (isPostgresDatabase()) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "share_token_hash" = $1 WHERE "id" = $2 AND "share_token_hash" IS NULL`,
          hash,
          row.id,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "share_token_hash" = ? WHERE "id" = ? AND "share_token_hash" IS NULL`,
          hash,
          row.id,
        );
      }
    }

    if (rows.length > 0) {
      logger.info({ table, count: rows.length }, "Backfilled legacy share token hashes");
    }
  } catch (err: any) {
    if (err?.message?.includes("no such table") || err?.message?.includes("does not exist")) {
      logger.warn({ table }, "File table not found, skipping access backfill");
      return;
    }
    logger.warn({ err: err?.message, table }, "Failed to backfill legacy file access");
  }
}

export async function ensureFileAccessColumns(): Promise<void> {
  if (!prisma) return;

  const dateType = isPostgresDatabase() ? postgresDateType() : "DATETIME";
  for (const table of SHAREABLE_FILE_TABLES) {
    await addColumnIfMissing(table, "public_access", `"public_access" TEXT NOT NULL DEFAULT 'off'`);
    await addColumnIfMissing(table, "share_token_hash", '"share_token_hash" TEXT');
    await addColumnIfMissing(table, "share_expires_at", `"share_expires_at" ${dateType}`);
    await backfillLegacyFileAccess(table);
  }
}

/** Recover legacy file ownership only when the containing project has a known creator. */
export async function backfillLegacyFileOwners(): Promise<void> {
  if (!prisma) return;

  for (const table of SHAREABLE_FILE_TABLES) {
    try {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "${table}"
        SET "user_id" = (
          SELECT "user_id" FROM "projects"
          WHERE "projects"."id" = "${table}"."project_id"
        )
        WHERE "user_id" IS NULL
          AND "project_id" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "projects"
            WHERE "projects"."id" = "${table}"."project_id"
              AND "projects"."user_id" IS NOT NULL
          )
      `);
      if (updated > 0) logger.info({ table, count: updated }, "Backfilled legacy file creators from project owners");
    } catch (err: any) {
      if (err?.message?.includes("no such table") || err?.message?.includes("does not exist")) continue;
      logger.warn({ err: err?.message, table }, "Failed to backfill legacy file creators (non-fatal)");
    }
  }
}

export async function createErdMetadataTablesIfMissing(): Promise<void> {
  if (!prisma) return;
  try {
    const textType = isLocalPostgres() ? "TEXT" : "TEXT";
    const dateType = isPostgresDatabase() ? postgresDateType() : "DATETIME";
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "table_constraints" (
        "id" ${textType} NOT NULL PRIMARY KEY,
        "entity_id" ${textType} NOT NULL,
        "kind" ${textType} NOT NULL,
        "name" ${textType},
        "column_ids" ${textType},
        "expression" ${textType},
        "created_at" ${dateType} DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "table_constraints_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_table_constraints_entity" ON "table_constraints"("entity_id")`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "table_indexes" (
        "id" ${textType} NOT NULL PRIMARY KEY,
        "entity_id" ${textType} NOT NULL,
        "name" ${textType} NOT NULL,
        "column_ids" ${textType} NOT NULL,
        "is_unique" BOOLEAN DEFAULT false,
        "algorithm" ${textType},
        "created_at" ${dateType} DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "table_indexes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_table_indexes_entity" ON "table_indexes"("entity_id")`);
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to create ERD metadata tables (non-fatal)");
  }
}

export async function normalizeLegacyColumnIds(): Promise<void> {
  if (!prisma) return;

  try {
    const columns: { id: string }[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "columns"`,
    );
    const legacy = columns.filter((column) => column.id && !isUuid(column.id));
    if (legacy.length === 0) return;

    await prisma.$transaction(async (tx) => {
      for (const column of legacy) {
        const newId = randomUUID();
        await tx.$executeRawUnsafe(
          `UPDATE "columns" SET "id" = ? WHERE "id" = ?`,
          newId,
          column.id,
        );
        const relationships: {
          id: string;
          source_column_id: string | null;
          target_column_id: string | null;
          source_handle: string | null;
          target_handle: string | null;
        }[] = await tx.$queryRawUnsafe(
          `SELECT id, source_column_id, target_column_id, source_handle, target_handle
           FROM "relationships"
           WHERE source_column_id = ? OR target_column_id = ?
             OR source_handle LIKE ? OR target_handle LIKE ?`,
          column.id,
          column.id,
          `%${column.id}%`,
          `%${column.id}%`,
        );
        for (const relationship of relationships) {
          await tx.$executeRawUnsafe(
            `UPDATE "relationships"
             SET source_column_id = ?, target_column_id = ?, source_handle = ?, target_handle = ?
             WHERE id = ?`,
            relationship.source_column_id === column.id ? newId : relationship.source_column_id,
            relationship.target_column_id === column.id ? newId : relationship.target_column_id,
            replaceColumnIdInHandle(relationship.source_handle, column.id, newId),
            replaceColumnIdInHandle(relationship.target_handle, column.id, newId),
            relationship.id,
          );
        }
      }
    }, { timeout: 30000 });

    logger.info({ count: legacy.length }, "Normalized legacy ERD column ids to UUIDs");
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      logger.warn("ERD tables not found, skipping column id normalization");
      return;
    }
    logger.warn({ err: err?.message }, "Failed to normalize ERD column ids (non-fatal)");
  }
}

