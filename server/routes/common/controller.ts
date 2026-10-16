import { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { isDesktopMode } from "../../lib/config.js";
import { emptyTrash, fetchTrashItems } from "./service.js";
import { isSsoAuthMode } from "../../lib/config.js";
import { StorageConfig, buildS3Client, uploadToS3, deleteFromS3, getEnvStorageConfig, generateSignedUrl, serveFromS3, objectExists } from "../../lib/storage.js";
import { DocumentImageBudgetError, StorageQuotaError, requestObjectDeletion, reserveUpload, resolveStorageScope, settleUpload } from "../../lib/storage-usage.js";
import { detectUploadImageType, getStorageAssetAccess, normalizeStorageKey, requiresPrivateStorage } from "../../lib/storage-access.js";

/**
 * Try to resolve an S3 client and storage config, checking:
 * 1. Environment variables (existing .env setup)
 * 2. Database-stored configuration (for desktop app)
 */
export async function resolveStorage(userId: string): Promise<{
  s3: any;
  config: StorageConfig;
} | null> {
  // 1. Try DB-stored config first (user explicitly saved this in desktop app)
  if (prisma) {
    try {
      const pref = await (prisma as any).userPreference.findUnique({
        where: { userId },
      });

      if (pref?.storageConfig) {
        const config: StorageConfig = JSON.parse(pref.storageConfig);
        const s3 = buildS3Client(config);
        if (s3) {
          return { s3, config };
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to load storage config from DB");
    }
  }

  // 2. Fallback to env vars
  const envConfig = getEnvStorageConfig();
  if (envConfig) {
    return {
      s3: buildS3Client(envConfig),
      config: envConfig,
    };
  }

  return null;
}

export async function getTrash(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  const userId = (req as any).user.id;
  try {
    const result = await fetchTrashItems(userId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Trash fetch error:");
    res.status(500).json({ error: "Failed to fetch trash items" });
  }
}

export async function emptyTrashHandler(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  if (!isSsoAuthMode()) {
    res.status(404).json({ error: "Not available" });
    return;
  }
  try {
    res.json({ deleted: await emptyTrash((req as any).user.id) });
  } catch (err: any) {
    logger.error({ err }, "Empty trash error:");
    res.status(500).json({ error: "Failed to empty trash" });
  }
}

export async function testR2(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const storage = await resolveStorage(userId);
  if (!storage) {
    res.status(500).json({
      error: "Storage is not configured. Please add storage configuration in Settings.",
    });
    return;
  }

  try {
    const { s3, config } = storage;
    const testKey = `test-connection-${Date.now()}.txt`;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: testKey,
        Body: "Connection test",
        ContentType: "text/plain",
      })
    );

    const publicUrl = config.publicUrl || "Not configured";

    res.json({
      success: true,
      message: "Successfully connected to storage.",
      bucket: config.bucketName,
      testFile: testKey,
      publicUrl,
    });
  } catch (err: any) {
    logger.error({ err: err }, "Storage Test Error:");
    res.status(500).json({ error: "Failed to connect to storage" });
  }
}

export async function uploadFile(req: any, res: ExpressResponse): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const fileType = detectUploadImageType(req.file.buffer);
  if (!fileType) {
    res.status(400).json({ error: "File type is not allowed. Use JPEG, PNG, WebP or SVG." });
    return;
  }

  const storage = await resolveStorage(userId);
  if (!storage) {
    res.status(500).json({ error: "Storage is not configured. Please add storage configuration in Settings." });
    return;
  }

  try {
    const { s3, config } = storage;
    const feature = String(req.body.feature);
    if (requiresPrivateStorage(feature) && config.publicUrl) {
      res.status(409).json({ error: "Private document assets require storage without a public URL." });
      return;
    }
    const file = req.file;
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileType.ext}`;
    // PostgreSQL modes group objects by owner scope (team/<id> or user/<id>); Desktop and CLI keep the old layout.
    const scope = await resolveStorageScope(userId);
    const folder = scope ? `${scope.prefix}/${feature}` : feature;
    const key = `erd-builder-pro/${folder}/${fileName}`;
    if (scope) {
      // shortcut: uploads without a document id (Word import) skip the per-document budget; storage quota still applies.
      await reserveUpload({ scope, key, userId, feature, mimeType: fileType.mime, bytes: file.size, documentUid: req.body.document ?? null });
    }

    // Build the URL based on storage config:
    // - If publicUrl is set → direct public URL
    // - Otherwise → proxy URL (no expiry, auth via cookie/token)
    const protocol = req.protocol;
    const host = req.get("host") || "localhost:3099";
    const originHost = `${protocol}://${host}`;

    let url: string;
    try {
      url = await uploadToS3(s3 as any, config, folder, fileName, file.buffer, fileType.mime, originHost);
      if (scope) await settleUpload(key, true);
    } catch (err) {
      // An unknown PutObject outcome is settled by asking the bucket; if that fails too, nightly cleanup settles it.
      if (scope) await objectExists(s3 as any, config, key).then((stored) => settleUpload(key, stored)).catch(() => undefined);
      throw err;
    }

    // Private document assets use a short-lived signed URL; the proxy remains a fallback.
    let signedUrl: string | null = null;
    try {
      signedUrl = await generateSignedUrl(s3 as any, config, key, 900);
    } catch {
      // Some S3-compatible providers may not support presigning.
      signedUrl = null;
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      url: requiresPrivateStorage(feature) ? signedUrl || url : url,
      key,
      signedUrl,
      proxyUrl: config.publicUrl ? null : `${originHost}/api/serve/${key}`,
    });
  } catch (err: any) {
    if (err instanceof DocumentImageBudgetError) {
      res.status(409).json({ error: err.message, code: err.code, limit_images: err.limitImages, limit_bytes: err.limitBytes });
      return;
    }
    if (err instanceof StorageQuotaError) {
      res.status(409).json({ error: err.message, code: err.code, used_bytes: err.usedBytes, limit_bytes: err.limitBytes });
      return;
    }
    logger.error({ err: err }, "Storage upload error:");
    res.status(500).json({ error: "Failed to upload file" });
  }
}

export async function deleteFile(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  const key = normalizeStorageKey(req.body?.key);
  if (!key) {
    res.status(403).json({ error: "Invalid file key" });
    return;
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const access = await getStorageAssetAccess(userId, key);
  if (!access.canDelete) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // PostgreSQL modes never delete objects in a request: a tracked object is only marked (H3) and background cleanup
  // removes it after the grace; an untracked legacy object is left for the same cleanup (CLD-010 S0).
  if (!isDesktopMode()) {
    const outcome = await requestObjectDeletion(userId, key);
    if (outcome === "in_use") {
      res.status(409).json({ error: "This file is still used by a document.", code: "STORAGE_OBJECT_IN_USE" });
      return;
    }
    if (outcome === "not_found") {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json({ success: true });
    return;
  }

  const storage = await resolveStorage(userId);
  if (!storage) {
    res.status(500).json({ error: "Storage is not configured." });
    return;
  }

  try {
    const { s3, config } = storage;
    await deleteFromS3(s3 as any, config, key);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err }, "Storage delete error:");
    res.status(500).json({ error: "Failed to delete file" });
  }
}

/**
 * GET /api/serve/:key
 *
 * Proxy-stream a file from S3/R2 through Express.
 * This works for private storage buckets where direct URLs return 404.
 *
 * Auth: Accepts cookie, Authorization header, OR query param `token`.
 * Query param token is needed for cross-origin image loads in dev mode
 * where sameSite: "lax" blocks cookie transmission.
 */
export async function serveFile(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  // Extract the full key from the wildcard route param
  const rawKey = Array.isArray(req.params.key) ? req.params.key.join("/") : req.params.key;
  const key = normalizeStorageKey(rawKey);
  if (!key) {
    res.status(400).json({ error: "Invalid file key" });
    return;
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const access = await getStorageAssetAccess(userId, key);
  if (!access.canRead) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const storage = await resolveStorage(userId);
  if (!storage) {
    res.status(500).json({ error: "Storage is not configured" });
    return;
  }

  try {
    await serveFromS3(storage.s3 as any, storage.config, key, res);
  } catch (err: any) {
    logger.error({ err }, "Error serving file from storage:");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to serve file" });
    }
  }
}

/**
 * POST /api/signed-urls
 *
 * Generate pre-signed URLs for one or more S3 keys.
 * Used by the frontend to get fresh signed URLs when displaying content
 * that contains images from private storage.
 *
 * Body: { keys: string[], expiresIn?: number }
 * Response: { urls: Record<string, string> }
 */
export async function getSignedUrls(req: ExpressRequest, res: ExpressResponse): Promise<void> {
  const { keys, expiresIn } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ error: "keys must be a non-empty array" });
    return;
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const storage = await resolveStorage(userId);
  if (!storage) {
    res.status(500).json({ error: "Storage is not configured" });
    return;
  }

  try {
    const urls: Record<string, string> = {};
    const ttl = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;

    for (const key of keys) {
      const normalizedKey = normalizeStorageKey(key);
      if (!normalizedKey || !(await getStorageAssetAccess(userId, normalizedKey)).canRead) {
        urls[key] = "";
        continue;
      }
      urls[key] = await generateSignedUrl(storage.s3 as any, storage.config, normalizedKey, ttl);
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.json({ urls });
  } catch (err: any) {
    logger.error({ err }, "Error generating signed URLs:");
    res.status(500).json({ error: "Failed to generate signed URLs" });
  }
}
