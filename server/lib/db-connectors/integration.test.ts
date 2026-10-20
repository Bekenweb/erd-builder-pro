import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import mysql from "mysql2/promise";
import { postgresqlConnector } from "./postgresql.js";
import { mysqlConnector } from "./mysql.js";
import type { ConnectionInfo, TableSchema } from "./types.js";
import { buildRecordDelete, buildRecordInsert, buildRecordUpdate, buildRecordWhere, validateDefaultColumns, validateRecordValues } from "../../routes/connections/record-helpers.js";
import { buildStructureStatements } from "../../routes/connections/structure-helpers.js";

const enabled = process.env.DB_CLIENT_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const allowedColumns = new Set(["id", "name", "role", "active", "updated_at"]);

const pgInfo: ConnectionInfo = {
  type: "postgresql",
  host: "127.0.0.1",
  port: Number(process.env.DB_CLIENT_PG_PORT || 55432),
  user: "erdbpro_test",
  password: "erdbpro_test",
  database: "dbclient_test",
  sslMode: "disable",
};

const mysqlInfo: ConnectionInfo = {
  type: "mysql",
  host: "127.0.0.1",
  port: Number(process.env.DB_CLIENT_MYSQL_PORT || 53306),
  user: "erdbpro_test",
  password: "erdbpro_test",
  database: "dbclient_test",
  sslMode: "disable",
};

function table(schema: TableSchema[], name: string) {
  const result = schema.find(item => item.table_name === name);
  expect(result, `Expected table ${name}`).toBeDefined();
  return result!;
}

suite("DB Client real database integration", () => {
  let pgClient: pg.Client;
  let mysqlClient: mysql.Connection;

  beforeAll(async () => {
    pgClient = new pg.Client({
      host: pgInfo.host,
      port: pgInfo.port,
      user: pgInfo.user,
      password: pgInfo.password,
      database: pgInfo.database,
    });
    await pgClient.connect();
    await pgClient.query(`
      DROP TABLE IF EXISTS integration_posts, integration_users CASCADE;
      CREATE TABLE integration_users (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      COMMENT ON TABLE integration_users IS 'DB Client integration users';
      CREATE UNIQUE INDEX integration_users_name_key ON integration_users (name);
      CREATE TABLE integration_posts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES integration_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      );
    `);

    mysqlClient = await mysql.createConnection({
      host: mysqlInfo.host,
      port: mysqlInfo.port,
      user: mysqlInfo.user,
      password: mysqlInfo.password,
      database: mysqlInfo.database,
    });
    await mysqlClient.query("DROP TABLE IF EXISTS integration_posts");
    await mysqlClient.query("DROP TABLE IF EXISTS integration_users");
    await mysqlClient.query(`
      CREATE TABLE integration_users (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        role ENUM('member', 'admin') NOT NULL DEFAULT 'member',
        active TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY integration_users_name_key (name)
      ) COMMENT='DB Client integration users'
    `);
    await mysqlClient.query(`
      CREATE TABLE integration_posts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        CONSTRAINT integration_posts_user_fk FOREIGN KEY (user_id)
          REFERENCES integration_users(id) ON DELETE CASCADE
      )
    `);
  }, 60_000);

  afterAll(async () => {
    await pgClient?.end();
    await mysqlClient?.end();
  });

  it("connects and reads PostgreSQL metadata with valid temporal precision", async () => {
    await expect(postgresqlConnector.test(pgInfo)).resolves.toMatch(/^OK \(\d+ms\)$/);
    const schema = await postgresqlConnector.fetchSchema(pgClient, pgInfo);
    const users = table(schema, "integration_users");
    const posts = table(schema, "integration_posts");
    const updatedAt = users.columns.find(column => column.name === "updated_at");

    expect(users.comment).toBe("DB Client integration users");
    expect(updatedAt?.full_type).toBe("timestamp(3) without time zone");
    expect(users.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "integration_users_name_key", is_unique: true }),
    ]));
    expect(posts.foreign_keys).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "user_id", ref_table: "integration_users", on_delete: "CASCADE" }),
    ]));

    const statements = buildStructureStatements("postgresql", users, {
      columnName: "updated_at",
      column: { name: "updated_at", type: "TIMESTAMP(3)", is_nullable: false, column_default: "CURRENT_TIMESTAMP" },
    }, schema);
    for (const statement of statements) await pgClient.query(statement);
  });

  it("executes PostgreSQL record helpers against the real driver", async () => {
    const insert = buildRecordInsert("postgresql", { name: "Alice", role: "admin", active: true }, allowedColumns);
    const inserted = await pgClient.query(`INSERT INTO integration_users${insert.sql} RETURNING id`, insert.params);
    const id = inserted.rows[0].id;
    const update = buildRecordUpdate("postgresql", { role: "member" }, { id }, allowedColumns);
    await pgClient.query(`UPDATE integration_users${update.sql}`, update.params);
    const filter = buildRecordWhere("postgresql", [{ enabled: true, column: "name", operator: "CONTAINS", value: "ali" }], allowedColumns);
    const selected = await pgClient.query(`SELECT name, role FROM integration_users${filter.sql}`, filter.params);
    expect(selected.rows).toEqual([{ name: "Alice", role: "member" }]);
    // The default UI filter is "first column CONTAINS": on a bigint id it used to fail with "operator does not exist".
    const numeric = buildRecordWhere("postgresql", [{ enabled: true, column: "id", operator: "CONTAINS", value: String(id) }], allowedColumns);
    const byId = await pgClient.query(`SELECT name FROM integration_users${numeric.sql}`, numeric.params);
    expect(byId.rows).toEqual([{ name: "Alice" }]);
    const deletion = buildRecordDelete("postgresql", { id }, allowedColumns);
    await pgClient.query(`DELETE FROM integration_users${deletion.sql}`, deletion.params);
  });

  it("connects and reads MySQL metadata with enum, boolean, index and relation", async () => {
    await expect(mysqlConnector.test(mysqlInfo)).resolves.toMatch(/^OK \(\d+ms\)$/);
    const schema = await mysqlConnector.fetchSchema(mysqlClient, mysqlInfo);
    const users = table(schema, "integration_users");
    const posts = table(schema, "integration_posts");
    const updatedAt = users.columns.find(column => column.name === "updated_at");
    const role = users.columns.find(column => column.name === "role");

    expect(users.comment).toBe("DB Client integration users");
    expect(updatedAt?.full_type).toBe("timestamp(3)");
    expect(role?.enum_values).toBe("enum('member','admin')");
    expect(users.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "integration_users_name_key", is_unique: true }),
    ]));
    expect(posts.foreign_keys).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "user_id", ref_table: "integration_users", on_delete: "CASCADE" }),
    ]));

    const statements = buildStructureStatements("mysql", users, {
      columnName: "updated_at",
      column: { name: "updated_at", type: "TIMESTAMP(3)", is_nullable: false, column_default: "CURRENT_TIMESTAMP" },
    }, schema);
    for (const statement of statements) await mysqlClient.query(statement);
  });

  it("executes MySQL record helpers against the real driver", async () => {
    const insert = buildRecordInsert("mysql", { name: "Bob", role: "admin", active: 1 }, allowedColumns);
    const [inserted] = await mysqlClient.query(`INSERT INTO integration_users${insert.sql}`, insert.params);
    const id = (inserted as mysql.ResultSetHeader).insertId;
    const update = buildRecordUpdate("mysql", { role: "member" }, { id }, allowedColumns);
    await mysqlClient.query(`UPDATE integration_users${update.sql}`, update.params);
    const filter = buildRecordWhere("mysql", [{ enabled: true, column: "name", operator: "CONTAINS", value: "ob" }], allowedColumns);
    const [selected] = await mysqlClient.query(`SELECT name, role FROM integration_users${filter.sql}`, filter.params);
    expect(selected).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Bob", role: "member" })]));
    const deletion = buildRecordDelete("mysql", { id }, allowedColumns);
    await mysqlClient.query(`DELETE FROM integration_users${deletion.sql}`, deletion.params);
  });
  // NULL, empty string, DEFAULT, boolean, generated and primary-key columns must stay distinct end to end.
  const cellColumns = (schema: TableSchema[]) => new Map<string, any>(table(schema, "integration_cells").columns.map(column => [column.name, column]));
  const cellColumnNames = new Set(["id", "label", "tag", "active", "code"]);

  it("keeps NULL, empty string, DEFAULT, boolean, generated and primary-key cells distinct on PostgreSQL", async () => {
    await pgClient.query(`
      DROP TABLE IF EXISTS integration_cells;
      CREATE TABLE integration_cells (
        id BIGSERIAL PRIMARY KEY,
        label VARCHAR(40),
        tag VARCHAR(20) DEFAULT 'none',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        code TEXT GENERATED ALWAYS AS (upper(label)) STORED
      )`);
    try {
      const columns = cellColumns(await postgresqlConnector.fetchSchema(pgClient, pgInfo));
      const one = async () => (await pgClient.query("SELECT label, tag, active, code FROM integration_cells WHERE id = 1")).rows[0];
      await pgClient.query("INSERT INTO integration_cells (id) VALUES (1)");
      expect(await one()).toEqual({ label: null, tag: "none", active: true, code: null });

      const update = async (values: Record<string, any>, defaults: string[] = []) => {
        const checked = validateRecordValues("postgresql", values, columns);
        const built = buildRecordUpdate("postgresql", checked, { id: 1 }, cellColumnNames, validateDefaultColumns(defaults, columns, values));
        await pgClient.query(`UPDATE integration_cells${built.sql}`, built.params);
      };
      await update({ label: "" });
      expect(await one()).toMatchObject({ label: "", code: "" });
      await update({ label: null });
      expect(await one()).toMatchObject({ label: null, code: null });
      await update({ tag: "custom" });
      await update({}, ["tag"]);
      expect((await one()).tag).toBe("none");
      await update({ active: 0 });
      expect((await one()).active).toBe(false);

      expect(() => validateRecordValues("postgresql", { code: "X" }, columns)).toThrow("Generated column");
      expect(() => validateRecordValues("postgresql", { id: 9 }, columns)).toThrow("Primary key");
      expect(() => validateDefaultColumns(["code"], columns)).toThrow("Generated column");
      expect(() => validateDefaultColumns(["id"], columns)).toThrow("Primary key");
      expect(() => validateRecordValues("postgresql", { active: true }, columns)).toThrow("0 or 1");
    } finally {
      await pgClient.query("DROP TABLE IF EXISTS integration_cells");
    }
  });

  it("keeps NULL, empty string, DEFAULT, boolean, generated and primary-key cells distinct on MySQL", async () => {
    await mysqlClient.query("DROP TABLE IF EXISTS integration_cells");
    await mysqlClient.query(`
      CREATE TABLE integration_cells (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        label VARCHAR(40) NULL,
        tag VARCHAR(20) NULL DEFAULT 'none',
        active TINYINT(1) NOT NULL DEFAULT 1,
        code VARCHAR(40) GENERATED ALWAYS AS (UPPER(label)) STORED
      )`);
    try {
      const columns = cellColumns(await mysqlConnector.fetchSchema(mysqlClient, mysqlInfo));
      const one = async () => ((await mysqlClient.query("SELECT label, tag, active, code FROM integration_cells WHERE id = 1"))[0] as any[])[0];
      await mysqlClient.query("INSERT INTO integration_cells (id) VALUES (1)");
      expect(await one()).toEqual({ label: null, tag: "none", active: 1, code: null });

      const update = async (values: Record<string, any>, defaults: string[] = []) => {
        const checked = validateRecordValues("mysql", values, columns);
        const built = buildRecordUpdate("mysql", checked, { id: 1 }, cellColumnNames, validateDefaultColumns(defaults, columns, values));
        await mysqlClient.query(`UPDATE integration_cells${built.sql}`, built.params);
      };
      await update({ label: "" });
      expect(await one()).toMatchObject({ label: "", code: "" });
      await update({ label: null });
      expect(await one()).toMatchObject({ label: null, code: null });
      await update({ tag: "custom" });
      await update({}, ["tag"]);
      expect((await one()).tag).toBe("none");
      await update({ active: 0 });
      expect((await one()).active).toBe(0);

      expect(() => validateRecordValues("mysql", { code: "X" }, columns)).toThrow("Generated column");
      expect(() => validateRecordValues("mysql", { id: 9 }, columns)).toThrow("Primary key");
      expect(() => validateDefaultColumns(["code"], columns)).toThrow("Generated column");
      expect(() => validateDefaultColumns(["id"], columns)).toThrow("Primary key");
      expect(() => validateRecordValues("mysql", { active: 2 }, columns)).toThrow("0 or 1");
    } finally {
      await mysqlClient.query("DROP TABLE IF EXISTS integration_cells");
    }
  });
});
