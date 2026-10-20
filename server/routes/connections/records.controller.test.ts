import { beforeEach, describe, expect, it, vi } from "vitest";

const release = vi.fn();
const fetchSchemaForClient = vi.fn();

vi.mock("../../lib/db-connectors/registry.js", () => ({
  getConnector: () => ({ connect: async () => ({ client: {}, release }) }),
  fetchSchemaForClient: (...args: any[]) => fetchSchemaForClient(...args),
}));
vi.mock("./catalogs.service.js", () => ({ findCatalogById: async () => ({ id: 1 }) }));
vi.mock("./middleware.js", () => ({ buildCatalogConnectionInfo: () => ({ type: "postgresql", database: "app" }) }));

const { recordContext } = await import("./records.controller.js");
const req = { user: { id: "u1" } } as any;

describe("recordContext pool release", () => {
  beforeEach(() => { release.mockClear(); fetchSchemaForClient.mockReset(); });

  it("releases the client when the schema read fails, so repeated failures cannot exhaust the pool", async () => {
    fetchSchemaForClient.mockRejectedValue(new Error("schema timeout"));
    for (let i = 0; i < 6; i += 1) await expect(recordContext(req, "1", "users")).rejects.toThrow("schema timeout");
    expect(release).toHaveBeenCalledTimes(6);
  });

  it("releases on an unknown table and keeps the client for a valid one", async () => {
    fetchSchemaForClient.mockResolvedValue([{ table_name: "users", columns: [] }]);
    await expect(recordContext(req, "1", "missing")).rejects.toThrow("Invalid table name");
    expect(release).toHaveBeenCalledTimes(1);
    const context = await recordContext(req, "1", "users");
    expect(context.tableSchema.table_name).toBe("users");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
