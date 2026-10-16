import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";
import { missingStaticAsset } from "./missing-static-asset.js";

it("does not cache a missing chunk and serves it once it becomes available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "erd-static-"));
  const app = express();
  app.use("/assets", express.static(dir), missingStaticAsset);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/assets/chunk.js`;
  try {
    const missing = await fetch(url);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    await writeFile(join(dir, "chunk.js"), "export default 1;");
    const available = await fetch(url);
    expect(available.status).toBe(200);
    expect(await available.text()).toBe("export default 1;");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
