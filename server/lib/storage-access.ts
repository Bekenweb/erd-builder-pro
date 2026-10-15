import { prisma } from "./prisma.js";
import { trackedObjectAccess } from "./storage-usage.js";

const STORAGE_KEY_PREFIX = "erd-builder-pro/";

export type UploadImageType = { mime: string; ext: string };

/** Detects an allowed upload type from its bytes, never from the client-declared MIME type (CLD-010 G2). */
export function detectUploadImageType(buffer: Buffer): UploadImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  const head = buffer.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<") && /<svg[\s>]/i.test(head)) return { mime: "image/svg+xml", ext: "svg" };
  return null;
}

export function requiresPrivateStorage(feature: unknown): boolean {
  const normalized = typeof feature === "string" ? feature.trim().toLowerCase() : "";
  return normalized === "note" || normalized === "notes" || normalized === "drawing" || normalized === "drawings";
}

export function normalizeStorageKey(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const marker = value.replace(/\\n/g, "").replace(/\\r/g, "").indexOf(STORAGE_KEY_PREFIX);
  if (marker < 0) return null;

  const key = value
    .replace(/\\n/g, "")
    .replace(/\\r/g, "")
    .slice(marker)
    .split(/[?#"'\s<]/, 1)[0];

  if (!key || key.length > 512 || key.includes("..") || key.includes("\\")) return null;
  return key;
}

function isSignedStorageUrl(value: string): boolean {
  try {
    return new URL(value.replace(/&amp;/gi, "&"), "https://storage.invalid").searchParams.has("X-Amz-Signature");
  } catch {
    return false;
  }
}

function privateStorageKeyFromUrl(value: string): string | null {
  if (!value.includes("/api/serve/") && !isSignedStorageUrl(value)) return null;
  return normalizeStorageKey(value);
}

export function privateStorageKeysFromMarkup(markup: string): string[] {
  const keys = new Set<string>();
  const attributePattern = /\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(attributePattern)) {
    const key = privateStorageKeyFromUrl(match[1]);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function replacePrivateStorageUrls(markup: string, replacements: Record<string, string>): string {
  return markup.replace(/(\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (whole, prefix, url, suffix) => {
    const key = privateStorageKeyFromUrl(url);
    if (!key) return whole;
    return `${prefix}${replacements[key] || `/api/serve/${key}`}${suffix}`;
  });
}

export function privateStorageKeysFromDrawingData(rawData: string): string[] {
  try {
    const parsed = JSON.parse(rawData) as { files?: Record<string, { dataURL?: unknown }> };
    const keys = new Set<string>();
    for (const file of Object.values(parsed.files ?? {})) {
      if (typeof file?.dataURL !== "string") continue;
      const key = privateStorageKeyFromUrl(file.dataURL);
      if (key) keys.add(key);
    }
    return [...keys];
  } catch {
    return [];
  }
}

export function replacePrivateStorageUrlsInDrawingData(rawData: string, replacements: Record<string, string>): string {
  try {
    const parsed = JSON.parse(rawData) as { files?: Record<string, { dataURL?: unknown }> };
    let changed = false;
    for (const file of Object.values(parsed.files ?? {})) {
      if (typeof file?.dataURL !== "string") continue;
      const key = privateStorageKeyFromUrl(file.dataURL);
      if (!key) continue;
      const nextUrl = replacements[key] || `/api/serve/${key}`;
      if (nextUrl !== file.dataURL) {
        file.dataURL = nextUrl;
        changed = true;
      }
    }
    return changed ? JSON.stringify(parsed) : rawData;
  } catch {
    return rawData;
  }
}

function accessibleFileScope(userId: string) {
  return {
    isDeleted: false,
    OR: [
      { userId, projectId: null },
      {
        project: {
          isDeleted: false,
          OR: [
            { userId, teamId: null },
            {
              teamId: { not: null },
              team: {
                type: { not: "personal" },
                status: "active",
                members: { some: { userId, status: "active" } },
              },
            },
          ],
        },
      },
    ],
  };
}

export async function getStorageAssetAccess(userId: string, rawKey: unknown): Promise<{
  canRead: boolean;
  canDelete: boolean;
}> {
  const key = normalizeStorageKey(rawKey);
  if (!prisma || !key) return { canRead: false, canDelete: false };

  // Tracked objects are authorized by their owner scope, never by which document mentions the key (CLD-010 H8).
  const tracked = await trackedObjectAccess(userId, key);
  if (tracked.tracked) return { canRead: tracked.canRead, canDelete: tracked.canManage };

  const scope = accessibleFileScope(userId);
  const [notes, drawings] = await Promise.all([
    prisma.note.findMany({
      where: { ...scope, content: { contains: key } } as any,
      select: { userId: true },
    }),
    prisma.drawing.findMany({
      where: { ...scope, data: { contains: key } } as any,
      select: { userId: true },
    }),
  ]);
  const references = [...notes, ...drawings];

  return {
    canRead: references.length > 0,
    canDelete: references.length > 0 && references.every((reference) => reference.userId === userId),
  };
}
