import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { SUPABASE_URL } from "./config.js";

export function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export function postgresDateType(): string {
  return SUPABASE_URL ? "TIMESTAMPTZ(6)" : "TIMESTAMPTZ(3)";
}

export type ColumnInfo = {
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
};

export async function getColumns(table: string): Promise<ColumnInfo[]> {
  if (!prisma) return [];
  try {
    if (isPostgresDatabase()) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT column_name AS name, data_type AS type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        table,
      );
      return rows.map((r: any) => ({
        name: r.name,
        type: (r.type || "TEXT").toUpperCase(),
        notnull: r.is_nullable === "NO",
        dflt_value: r.column_default,
        pk: false,
      }));
    }
    const rows: any[] = await prisma.$queryRawUnsafe(
      `PRAGMA table_info("${table}")`,
    );
    return rows.map((r: any) => ({
      name: r.name,
      type: (r.type || "TEXT").toUpperCase(),
      notnull: !!r.notnull,
      dflt_value: r.dflt_value,
      pk: !!r.pk,
    }));
  } catch {
    return [];
  }
}

export async function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (!prisma) return;
  try {
    const cols = await getColumns(table);
    if (cols.some((c) => c.name === column)) {
      logger.info({ table, column }, "Column already exists, skipping migration");
      return;
    }
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN ${definition}`,
    );
    logger.info({ table, column }, "Column added via startup migration");
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      logger.warn({ table }, "Table not found, skipping column migration");
      return;
    }
    logger.warn({ err: err?.message, table, column }, "Failed to add column (non-fatal)");
  }
}

/**
 * Change a column's type by rebuilding the table.
 *
 * SQLite does NOT support ALTER COLUMN. The only safe way is:
 *   1. CREATE temp table with new schema
 *   2. INSERT ... SELECT (with optional CAST)
 *   3. DROP original → RENAME temp
 *
 * CRASH RISK: between DROP and RENAME data lives in temp table.
 * If crash occurs during that window, restart recovers:
 *   - original table gone, temp still there
 *   - re-run finds temp → renames it → completes
 *   - column type already matches → no-op next startup
 *
 * @param castExpr - SQL expression for casting existing data, e.g. "CAST(destinations AS INTEGER)"
 */
export async function ensureColumnType(
  table: string,
  column: string,
  newType: string,       // e.g. "INTEGER"
  castExpr?: string,
): Promise<void> {
  if (!prisma) return;

  try {
    // ── Recover from previous crash ──
    // If original table is missing but temp exists, rename temp back.
    const tempName = `__migrate_${table}_new`;
    const tempCols = await getColumns(tempName);
    const origCols = await getColumns(table);
    const origExists = origCols.length > 0;

    if (!origExists && tempCols.length > 0) {
      logger.warn({ tempName }, "Crash recovery: original table missing, renaming temp");
      await prisma.$executeRawUnsafe(`ALTER TABLE "${tempName}" RENAME TO "${table}"`);
      logger.info({ table }, "Crash recovery complete");
      return;
    }
    if (origExists && tempCols.length > 0) {
      // Both exist — previous migration crashed after CREATE but before DROP.
      // Clean up temp and retry fresh.
      logger.warn({ tempName }, "Crash recovery: orphan temp table exists, dropping it");
      await prisma.$executeRawUnsafe(`DROP TABLE "${tempName}"`);
    }

    // ── Check current type ──
    const existing = origCols.find((c) => c.name === column);
    if (!existing) {
      // Column missing — add it instead
      logger.info({ table, column }, "Column missing, adding via ALTER TABLE");
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${newType}`,
      );
      return;
    }

    const normal = (t: string) => t.replace(/\s+/g, "");
    if (normal(existing.type) === normal(newType.toUpperCase())) {
      logger.info({ table, column, type: existing.type }, "Column type matches, skipping");
      return;
    }

    logger.info(
      { table, column, from: existing.type, to: newType },
      "Column type changed — rebuilding table",
    );

    // ── Get indexes ──
    const idxList: any[] = await prisma.$queryRawUnsafe(
      `PRAGMA index_list("${table}")`,
    );
    const indexes: { name: string; unique: boolean; columns: string[] }[] = [];
    for (const idx of idxList) {
      if ((idx.name as string).startsWith("sqlite_autoindex")) continue;
      const cols: any[] = await prisma.$queryRawUnsafe(
        `PRAGMA index_info("${idx.name}")`,
      );
      indexes.push({
        name: idx.name,
        unique: !!idx.unique,
        columns: cols.map((c: any) => c.name),
      });
    }

    // ── Build CREATE TABLE ──
    const pkCols = origCols.filter((c) => c.pk).map((c) => `"${c.name}"`);
    const colDefs = origCols.map((c) => {
      const type = c.name === column ? newType : c.type;
      const parts = [`"${c.name}"`, type];
      if (c.notnull) parts.push("NOT NULL");
      if (c.dflt_value !== null) parts.push(`DEFAULT ${c.dflt_value}`);
      return parts.join(" ");
    });
    if (pkCols.length > 0) colDefs.push(`PRIMARY KEY (${pkCols.join(", ")})`);

    await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);

    try {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${tempName}" (\n  ${colDefs.join(",\n  ")}\n)`,
      );

      // ── Copy data with optional CAST ──
      const selectCols = origCols
        .map((c) => (c.name === column && castExpr ? castExpr : `"${c.name}"`))
        .join(", ");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${tempName}" SELECT ${selectCols} FROM "${table}"`,
      );

      // ── Swap ──
      await prisma.$executeRawUnsafe(`DROP TABLE "${table}"`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${tempName}" RENAME TO "${table}"`,
      );

      // ── Recreate indexes ──
      for (const idx of indexes) {
        const uq = idx.unique ? "UNIQUE " : "";
        const ic = idx.columns.map((c) => `"${c}"`).join(", ");
        await prisma.$executeRawUnsafe(
          `CREATE ${uq}INDEX "${idx.name}" ON "${table}" (${ic})`,
        );
      }

      logger.info({ table, column }, "Table rebuilt for column type change");
    } catch (err) {
      // Cleanup temp table on failure
      try {
        const stillThere = await getColumns(tempName);
        if (stillThere.length > 0)
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tempName}"`);
      } catch { /* best-effort */ }
      throw err;
    } finally {
      await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
    }
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      logger.warn({ table }, "Table not found, skipping migration");
      return;
    }
    logger.warn(
      { err: err?.message, table, column },
      "Failed to change column type (non-fatal)",
    );
  }
}
