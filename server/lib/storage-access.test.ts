import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  note: { findMany: vi.fn() },
  drawing: { findMany: vi.fn() },
  trackedObjectAccess: vi.fn(async (): Promise<any> => ({ tracked: false })),
}));

vi.mock("./storage-usage.js", () => ({ trackedObjectAccess: mocks.trackedObjectAccess }));

vi.mock("./prisma.js", () => ({
  prisma: { note: mocks.note, drawing: mocks.drawing },
}));

import {
  getStorageAssetAccess,
  normalizeStorageKey,
  privateStorageKeysFromDrawingData,
  privateStorageKeysFromMarkup,
  replacePrivateStorageUrlsInDrawingData,
  replacePrivateStorageUrls,
  requiresPrivateStorage,
  detectUploadImageType,
} from "./storage-access.js";

describe("storage asset access", () => {
  beforeEach(() => {
    mocks.note.findMany.mockReset().mockResolvedValue([]);
    mocks.drawing.findMany.mockReset().mockResolvedValue([]);
  });

  it("normalizes only safe ERD Builder storage keys", () => {
    expect(normalizeStorageKey("https://cdn.test/erd-builder-pro/notes/a.png?x=1")).toBe("erd-builder-pro/notes/a.png");
    expect(normalizeStorageKey("erd-builder-pro/notes/../private.png")).toBeNull();
    expect(normalizeStorageKey("https://cdn.test/other/a.png")).toBeNull();
  });

  it("requires private storage for document image features", () => {
    expect(requiresPrivateStorage("notes")).toBe(true);
    expect(requiresPrivateStorage(" note ")).toBe(true);
    expect(requiresPrivateStorage("drawings")).toBe(true);
    expect(requiresPrivateStorage("DRAWING")).toBe(true);
    expect(requiresPrivateStorage("general")).toBe(false);
  });

  it("rewrites only private proxy image URLs for public shares", () => {
    const markup = '<p><img src="https://app.test/api/serve/erd-builder-pro/notes/a.png?token=legacy-session"></p><img src="https://cdn.test/erd-builder-pro/notes/legacy.png">';
    const key = "erd-builder-pro/notes/a.png";

    expect(privateStorageKeysFromMarkup(markup)).toEqual([key]);
    expect(replacePrivateStorageUrls(markup, { [key]: "https://signed.test/a?expires=900" })).toContain("https://signed.test/a?expires=900");
    expect(replacePrivateStorageUrls(markup, { [key]: "https://signed.test/a?expires=900" })).toContain("https://cdn.test/erd-builder-pro/notes/legacy.png");
    expect(replacePrivateStorageUrls(markup, {})).not.toContain("legacy-session");
  });

  it("rewrites private proxy URLs inside Excalidraw file data", () => {
    const rawData = JSON.stringify({ files: {
      image: { dataURL: "https://app.test/api/serve/erd-builder-pro/drawings/a.png" },
      legacy: { dataURL: "https://cdn.test/erd-builder-pro/drawings/legacy.png" },
    } });
    const key = "erd-builder-pro/drawings/a.png";

    expect(privateStorageKeysFromDrawingData(rawData)).toEqual([key]);
    expect(JSON.parse(replacePrivateStorageUrlsInDrawingData(rawData, { [key]: "https://signed.test/a" }))).toEqual({
      files: {
        image: { dataURL: "https://signed.test/a" },
        legacy: { dataURL: "https://cdn.test/erd-builder-pro/drawings/legacy.png" },
      },
    });
  });

  it("allows reading an asset referenced by an accessible file", async () => {
    mocks.note.findMany.mockResolvedValue([{ userId: "creator" }]);

    await expect(getStorageAssetAccess("member", "erd-builder-pro/notes/a.png")).resolves.toEqual({
      canRead: true,
      canDelete: false,
    });

    expect(mocks.note.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ content: { contains: "erd-builder-pro/notes/a.png" } }),
    }));
  });

  it("requires an active non-Personal Team for Team file references", async () => {
    await getStorageAssetAccess("member", "erd-builder-pro/notes/team.png");

    const where = mocks.note.findMany.mock.calls[0][0].where;
    const teamBranch = where.OR.find((branch: any) => branch.project)?.project.OR.find((branch: any) => branch.team);
    expect(teamBranch.team).toMatchObject({ type: { not: "personal" }, status: "active" });
  });

  it("allows deletion only when every reference belongs to the caller", async () => {
    mocks.note.findMany.mockResolvedValue([{ userId: "creator" }]);
    await expect(getStorageAssetAccess("creator", "erd-builder-pro/notes/a.png")).resolves.toEqual({
      canRead: true,
      canDelete: true,
    });

    mocks.note.findMany.mockResolvedValue([{ userId: null }]);
    await expect(getStorageAssetAccess("creator", "erd-builder-pro/notes/legacy.png")).resolves.toEqual({
      canRead: true,
      canDelete: false,
    });
  });
});

describe("detectUploadImageType (CLD-010 G2)", () => {
  it("accepts JPEG, PNG, WebP and SVG by their bytes", () => {
    expect(detectUploadImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectUploadImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ mime: "image/png", ext: "png" });
    expect(detectUploadImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toEqual({ mime: "image/webp", ext: "webp" });
    expect(detectUploadImageType(Buffer.from('﻿ <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual({ mime: "image/svg+xml", ext: "svg" });
  });

  it("rejects GIF, PDF and content that only claims an image type", () => {
    expect(detectUploadImageType(Buffer.from("GIF89a", "latin1"))).toBeNull();
    expect(detectUploadImageType(Buffer.from("%PDF-1.7", "latin1"))).toBeNull();
    expect(detectUploadImageType(Buffer.from("synthetic fixture"))).toBeNull();
    expect(detectUploadImageType(Buffer.from("<html><body>svg</body></html>"))).toBeNull();
  });
});

describe("tracked object access (CLD-010 H8)", () => {
  it("uses the owner scope and ignores document references for tracked objects", async () => {
    mocks.note.findMany.mockClear();
    mocks.trackedObjectAccess.mockResolvedValueOnce({ tracked: true, canRead: false, canManage: false });
    mocks.note.findMany.mockResolvedValue([{ userId: "user-1" }]);

    await expect(getStorageAssetAccess("user-1", "erd-builder-pro/team/org-a/notes/a.png")).resolves.toEqual({ canRead: false, canDelete: false });
    expect(mocks.note.findMany).not.toHaveBeenCalled();
  });
});
