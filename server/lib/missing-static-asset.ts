import type { Request, Response } from "express";

export function missingStaticAsset(_req: Request, res: Response): void {
  // A deploy-time miss must not keep the app blank after the asset becomes available.
  res.set("Cache-Control", "no-store");
  res.status(404).end();
}
