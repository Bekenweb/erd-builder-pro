import { describe, expect, it, vi } from "vitest";
import { compressDecodedImage, compressImage, ImageUploadError, type ImageEncoder } from "../image-compression";

const KB = 1024;

function fileOf(size: number, type = "image/png", name = "shot.png") {
  return new File([new Uint8Array(size)], name, { type });
}

/** Fake encoder: output size follows pixels × quality; `webp` false simulates a browser without a WebP encoder. */
function encoder(bytesPerPixel: number, webp = true): ImageEncoder {
  return vi.fn(async (width, height, type, quality) => {
    const outType = type === "image/webp" && !webp ? "image/png" : type;
    return new Blob([new Uint8Array(Math.round(width * height * bytesPerPixel * quality))], { type: outType });
  });
}

describe("image compression (CLD-010 Q7)", () => {
  it("compresses even a small 300 KB file when that saves bytes", async () => {
    const result = await compressDecodedImage(fileOf(300 * KB), { width: 800, height: 600 }, encoder(0.2));
    expect(result.type).toBe("image/webp");
    expect(result.size).toBeLessThan(300 * KB);
  });

  it("keeps the original when re-encoding would be larger and it already fits", async () => {
    const original = fileOf(50 * KB);
    const result = await compressDecodedImage(original, { width: 800, height: 600 }, encoder(2));
    expect(result).toBe(original);
  });

  it("drops to stage two toward 300 KB when stage one stays above 1 MB", async () => {
    const result = await compressDecodedImage(fileOf(4 * 1024 * KB), { width: 4000, height: 3000 }, encoder(1.2));
    expect(result.size).toBeLessThanOrEqual(1024 * KB);
  });

  it("refuses when nothing gets under 1 MB", async () => {
    const stubborn: ImageEncoder = async (_w, _h, type) => new Blob([new Uint8Array(3 * 1024 * KB)], { type });
    await expect(compressDecodedImage(fileOf(4 * 1024 * KB), { width: 4000, height: 3000 }, stubborn)).rejects.toBeInstanceOf(ImageUploadError);
  });

  it("falls back to PNG for PNG and JPEG for photos without a WebP encoder", async () => {
    const png = await compressDecodedImage(fileOf(900 * KB), { width: 1000, height: 800 }, encoder(0.5, false));
    expect(png.type).toBe("image/png");
    const jpeg = await compressDecodedImage(fileOf(900 * KB, "image/jpeg", "a.jpg"), { width: 1000, height: 800 }, encoder(0.5, false));
    expect(jpeg.type).toBe("image/jpeg");
  });

  it("rejects GIF, PDF, oversize inputs and large SVG before any work", async () => {
    await expect(compressImage(fileOf(10, "image/gif", "a.gif"))).rejects.toThrow("Only JPEG, PNG, WebP or SVG");
    await expect(compressImage(fileOf(10, "application/pdf", "a.pdf"))).rejects.toThrow("Only JPEG, PNG, WebP or SVG");
    await expect(compressImage(fileOf(6 * 1024 * KB))).rejects.toThrow("larger than 5 MB");
    await expect(compressImage(fileOf(2 * 1024 * KB, "image/svg+xml", "a.svg"))).rejects.toThrow("1 MB or smaller");
    const svg = fileOf(10 * KB, "image/svg+xml", "a.svg");
    await expect(compressImage(svg)).resolves.toBe(svg);
  });
});
