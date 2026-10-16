import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicNote: vi.fn(),
  resolveStorage: vi.fn(),
  generateSignedUrl: vi.fn(),
  privateStorageKeysFromMarkup: vi.fn(),
  replacePrivateStorageUrls: vi.fn(),
  getUser: vi.fn(),
  isDesktopMode: vi.fn(() => false),
  getNoteForPermanentDelete: vi.fn(),
  permanentDeleteNote: vi.fn(),
  extractR2KeysFromContent: vi.fn(() => ["erd-builder-pro/notes/a.png"]),
  getStorageClientForUser: vi.fn(),
}));

vi.mock("../../lib/config.js", () => ({
  supabase: { auth: { getUser: mocks.getUser } },
  s3Client: null,
  R2_BUCKET_NAME: "test-bucket",
  isDesktopMode: mocks.isDesktopMode,
}));
vi.mock("../../lib/utils.js", () => ({ handleError: vi.fn() }));
vi.mock("../../lib/security.js", () => ({
  resolveNewFileProjectId: vi.fn(),
  resolveOwnedProjectId: vi.fn(),
}));
vi.mock("../../lib/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("./service.js", () => ({
  getPublicNote: mocks.getPublicNote,
  getNoteForPermanentDelete: mocks.getNoteForPermanentDelete,
  permanentDeleteNote: mocks.permanentDeleteNote,
  extractR2KeysFromContent: mocks.extractR2KeysFromContent,
}));
vi.mock("../../lib/storage.js", () => ({
  getStorageClientForUser: mocks.getStorageClientForUser,
  generateSignedUrl: mocks.generateSignedUrl,
}));
vi.mock("../../lib/storage-access.js", () => ({
  privateStorageKeysFromMarkup: mocks.privateStorageKeysFromMarkup,
  replacePrivateStorageUrls: mocks.replacePrivateStorageUrls,
}));
vi.mock("../common/controller.js", () => ({ resolveStorage: mocks.resolveStorage }));

import { getPublic, permanentDelete } from "./controller.js";

function response() {
  return { json: vi.fn(), setHeader: vi.fn(), status: vi.fn().mockReturnThis() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public Note assets", () => {
  it("replaces private proxy URLs with short-lived signed URLs", async () => {
    const note = {
      uid: "note-1",
      userId: "owner-1",
      title: "Shared note",
      content: '<img src="https://app.test/api/serve/erd-builder-pro/notes/a.png">',
      project: null,
      isDeleted: false,
      isPublic: true,
      expiryDate: null,
      shareToken: null,
    };
    const storage = { s3: {}, config: { type: "r2", bucketName: "bucket" } };
    const req = { params: { uid: note.uid }, cookies: {}, headers: {}, query: {} } as any;
    const res = response();

    mocks.getPublicNote.mockResolvedValue(note);
    mocks.resolveStorage.mockResolvedValue(storage);
    mocks.privateStorageKeysFromMarkup.mockReturnValue(["erd-builder-pro/notes/a.png"]);
    mocks.generateSignedUrl.mockResolvedValue("https://signed.test/a.png");
    mocks.replacePrivateStorageUrls.mockReturnValue('<img src="https://signed.test/a.png">');

    await getPublic(req, res);

    expect(mocks.generateSignedUrl).toHaveBeenCalledWith(
      storage.s3,
      storage.config,
      "erd-builder-pro/notes/a.png",
      900,
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      content: '<img src="https://signed.test/a.png">',
    }));
  });
});

describe("permanent Note delete (CLD-010 S0)", () => {
  const send = vi.fn().mockResolvedValue({});
  const request = { params: { uid: "note-1" }, user: { id: "owner-1" } } as any;

  beforeEach(() => {
    mocks.getNoteForPermanentDelete.mockResolvedValue({ id: 7, content: '<img src="/api/serve/erd-builder-pro/notes/a.png">' });
    mocks.getStorageClientForUser.mockResolvedValue({ client: { send }, bucketName: "bucket" });
  });

  it("deletes only the database row in PostgreSQL modes", async () => {
    const res = response();
    await permanentDelete(request, res);

    expect(send).not.toHaveBeenCalled();
    expect(mocks.permanentDeleteNote).toHaveBeenCalledWith(7);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("still deletes embedded images on Desktop and CLI", async () => {
    mocks.isDesktopMode.mockReturnValueOnce(true);
    await permanentDelete(request, response());

    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.permanentDeleteNote).toHaveBeenCalledWith(7);
  });
});
