import { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { fetchSchemaForClient, getConnector } from "../../lib/db-connectors/registry.js";
import { buildCatalogConnectionInfo } from "./middleware.js";
import { assertDestructiveAllowed, assertWritable } from "../../lib/db-connectors/security.js";
import * as catalogsService from "./catalogs.service.js";
import { logger } from "../../lib/logger.js";
import {
  buildRecordOrder,
  buildRecordDelete,
  buildRecordInsert,
  buildRecordUpdate,
  buildRecordWhere,
  executeInTransaction,
  fetchTableInfo,
  tableSqlFor,
  validateRecordValues,
} from "./record-helpers.js";

const mutationErrorStatus = (message: string) => /Safe Mode|Type ".*" to confirm/.test(message) ? 403 : 500;

export async function recordContext(req: ExpressRequest, id: string, table: string) {
  const userId = (req as any).user.id;
  const catalog = await catalogsService.findCatalogById(id, userId);
  if (!catalog) throw new Error("Catalog not found");
  const info = buildCatalogConnectionInfo(catalog);
  if (info.type === "sqlite") throw new Error("Record editing is not supported for SQLite catalogs");
  const connector = getConnector(info.type);
  const { client, release } = await connector.connect(info);
  // Release on every failure before the caller's try/finally exists, or each failed schema read leaks a pool slot (max 4).
  try {
    const schema = await fetchSchemaForClient(client, info);
    const tableSchema = schema.find((item: any) => item.table_name === table);
    if (!tableSchema) throw new Error("Invalid table name");
    return { info, client, release, tableSchema };
  } catch (err) {
    release();
    throw err;
  }
}

export async function queryRecords(req: ExpressRequest, res: ExpressResponse) {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { table, page = 1, pageSize = 50, filters, sort } = req.body;
  // Page changes reuse the client's total/table size; only the first page of a table+filter asks for them.
  const withTotal = req.body.withTotal !== false;

  if (!table?.trim()) {
    return res.status(400).json({ error: "table name is required" });
  }

  try {
    const catalog = await catalogsService.findCatalogById(id, userId);
    if (!catalog) return res.status(404).json({ error: "Catalog not found" });

    const info = buildCatalogConnectionInfo(catalog);

    const connector = getConnector(info.type);
    const { client, release } = await connector.connect(info);

    try {
      const limit = Math.min(Math.max(1, pageSize), 200);
      const offset = (Math.max(1, page) - 1) * limit;
      const schema = await fetchSchemaForClient(client, info);
      const tableSchema = schema.find((item: any) => item.table_name === table);
      if (!tableSchema) return res.status(400).json({ error: "Invalid table name" });

      const allowedColumns = new Set((tableSchema.columns || []).map((column: any) => column.name));
      let where: ReturnType<typeof buildRecordWhere>;
      let orderSql = "";
      try {
        const search = req.body.search && typeof req.body.search === "object"
          ? { value: String(req.body.search.value ?? ""), columns: Array.isArray(req.body.search.columns) ? req.body.search.columns.map(String) : undefined }
          : undefined;
        where = buildRecordWhere(info.type, Array.isArray(filters) ? filters : [], allowedColumns, search);
        const primaryKey = (tableSchema.columns || []).filter((column: any) => column.is_pk).map((column: any) => column.name);
        orderSql = buildRecordOrder(info.type, sort, allowedColumns, primaryKey);
      } catch (err: any) {
        return res.status(400).json({ error: err.message || "Invalid query options" });
      }

      let columns: string[] = [];
      let rows: Record<string, any>[] = [];
      let total: number | null = null;
      const tableInfo = withTotal ? await fetchTableInfo(info.type, client, info.database, tableSchema) : null;
      const tableSql = tableSqlFor(info.type, tableSchema);

      if (info.type === "postgresql") {
        if (withTotal) {
          const countRes = await (client as any).query(`SELECT COUNT(*)::int AS total FROM ${tableSql}${where.sql}`, where.params);
          total = countRes.rows[0]?.total || 0;
        }
        const dataRes = await (client as any).query(`SELECT * FROM ${tableSql}${where.sql}${orderSql} LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`, [...where.params, limit, offset]);
        columns = dataRes.fields.map((f: any) => f.name);
        rows = dataRes.rows;
      } else if (info.type === "mysql") {
        if (withTotal) {
          const [countRows] = await (client as any).execute(`SELECT COUNT(*) AS total FROM ${tableSql}${where.sql}`, where.params);
          total = Number(countRows[0]?.total || 0);
        }
        const [dataRows, dataFields] = await (client as any).execute(`SELECT * FROM ${tableSql}${where.sql}${orderSql} LIMIT ${limit} OFFSET ${offset}`, where.params);
        columns = (dataFields || []).map((f: any) => f.name || f.column || f);
        rows = dataRows;
      } else if (info.type === "sqlite") {
        if (withTotal) {
          const countResult = (client as any).exec(`SELECT COUNT(*) AS total FROM ${tableSql}${where.sql}`);
          total = countResult[0]?.values[0]?.[0] || 0;
        }
        const dataResult = (client as any).exec(`SELECT * FROM ${tableSql}${where.sql}${orderSql} LIMIT ${limit} OFFSET ${offset}`);
        if (dataResult[0]) {
          columns = dataResult[0].columns;
          rows = dataResult[0].values.map((vals: any[]) => Object.fromEntries(columns.map((col, i) => [col, vals[i]])));
        }
      }

      res.json({ columns, rows, total, page, pageSize: limit, tableInfo });
    } finally {
      release();
    }
  } catch (err: any) {
    logger.error({ err }, "Error querying records");
    res.status(500).json({ error: `Failed to query records: ${err.message}` });
  }
}

export async function updateRecord(req: ExpressRequest, res: ExpressResponse) {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { table, key, values } = req.body;
  const updateList = Array.isArray(req.body.updates) ? req.body.updates : [{ key, values }];

  if (!table?.trim()) return res.status(400).json({ error: "table name is required" });
  if (updateList.length === 0 || updateList.some((item: any) => !item?.key || typeof item.key !== "object")) return res.status(400).json({ error: "record key is required" });
  if (updateList.some((item: any) => !item.values || typeof item.values !== "object")) return res.status(400).json({ error: "update values are required" });

  try {
    const catalog = await catalogsService.findCatalogById(id, userId);
    if (!catalog) return res.status(404).json({ error: "Catalog not found" });

    const info = buildCatalogConnectionInfo(catalog);
    assertWritable(info);
    if (info.type === "sqlite") return res.status(400).json({ error: "Record editing is not supported for SQLite catalogs" });

    const connector = getConnector(info.type);
    const { client, release } = await connector.connect(info);
    try {
      const schema = await fetchSchemaForClient(client, info);
      const tableSchema = schema.find((item: any) => item.table_name === table);
      if (!tableSchema) return res.status(400).json({ error: "Invalid table name" });

      const columnByName = new Map<string, any>((tableSchema.columns || []).map((column: any) => [column.name, column]));
      const allowedColumns = new Set(columnByName.keys());
      const pkColumns = (tableSchema.columns || []).filter((column: any) => column.is_pk).map((column: any) => column.name);
      if (pkColumns.length === 0) return res.status(400).json({ error: "Table has no primary key" });
      for (const item of updateList) {
        for (const column of pkColumns) {
          if (!(column in item.key)) return res.status(400).json({ error: `Missing primary key column: ${column}` });
        }
      }

      const tableSql = tableSqlFor(info.type, tableSchema);
      const statements = [];
      for (const item of updateList) {
        let normalizedValues;
        try {
          normalizedValues = validateRecordValues(info.type, item.values, columnByName);
        } catch (err: any) {
          return res.status(400).json({ error: err.message || "Invalid update values" });
        }
        try {
          const update = buildRecordUpdate(info.type, normalizedValues, item.key, allowedColumns);
          statements.push({ sql: `UPDATE ${tableSql}${update.sql}`, params: update.params });
        } catch (err: any) {
          return res.status(400).json({ error: err.message || "Invalid update options" });
        }
      }

      await executeInTransaction(info.type, client, statements);
      res.json({ success: true, updated: statements.length });
    } finally {
      release();
    }
  } catch (err: any) {
    logger.error({ err }, "Error updating record");
    res.status(mutationErrorStatus(err.message)).json({ error: `Failed to update record: ${err.message}` });
  }
}

export async function createRecord(req: ExpressRequest, res: ExpressResponse) {
  const { id } = req.params;
  const { table, values } = req.body;
  if (!table?.trim()) return res.status(400).json({ error: "table name is required" });
  if (!values || typeof values !== "object") return res.status(400).json({ error: "insert values are required" });

  try {
    const { info, client, release, tableSchema } = await recordContext(req, id, table);
    try {
      assertWritable(info);
      const columnByName = new Map<string, any>((tableSchema.columns || []).map((column: any) => [column.name, column]));
      const allowedColumns = new Set(columnByName.keys());
      const normalizedValues = validateRecordValues(info.type, values, columnByName, true);
      const insert = buildRecordInsert(info.type, normalizedValues, allowedColumns);
      const tableSql = tableSqlFor(info.type, tableSchema);
      if (info.type === "postgresql") await (client as any).query(`INSERT INTO ${tableSql}${insert.sql}`, insert.params);
      else await (client as any).execute(`INSERT INTO ${tableSql}${insert.sql}`, insert.params);
      res.status(201).json({ success: true });
    } finally {
      release();
    }
  } catch (err: any) {
    const status = /Catalog not found/.test(err.message) ? 404 : /Safe Mode/.test(err.message) ? 403 : 400;
    res.status(status).json({ error: `Failed to create record: ${err.message}` });
  }
}

export async function deleteRecord(req: ExpressRequest, res: ExpressResponse) {
  const { id } = req.params;
  const { table, key, keys } = req.body;
  if (!table?.trim()) return res.status(400).json({ error: "table name is required" });
  const keyList = Array.isArray(keys) ? keys : key ? [key] : [];
  if (keyList.length === 0 || keyList.some(item => !item || typeof item !== "object")) return res.status(400).json({ error: "record key is required" });

  try {
    const { info, client, release, tableSchema } = await recordContext(req, id, table);
    try {
      assertDestructiveAllowed(info, table, req.body.confirmation);
      const allowedColumns = new Set((tableSchema.columns || []).map((column: any) => column.name));
      const pkColumns = (tableSchema.columns || []).filter((column: any) => column.is_pk).map((column: any) => column.name);
      if (pkColumns.length === 0) return res.status(400).json({ error: "Table has no primary key" });
      for (const item of keyList) {
        for (const column of pkColumns) {
          if (!(column in item)) return res.status(400).json({ error: `Missing primary key column: ${column}` });
        }
      }
      const tableSql = tableSqlFor(info.type, tableSchema);
      const statements = keyList.map(item => {
        const del = buildRecordDelete(info.type, item, allowedColumns);
        return { sql: `DELETE FROM ${tableSql}${del.sql}`, params: del.params };
      });
      await executeInTransaction(info.type, client, statements);
      res.json({ success: true, deleted: statements.length });
    } finally {
      release();
    }
  } catch (err: any) {
    const status = /Catalog not found/.test(err.message) ? 404 : /Safe Mode|Type ".*" to confirm/.test(err.message) ? 403 : 400;
    res.status(status).json({ error: `Failed to delete record: ${err.message}` });
  }
}
