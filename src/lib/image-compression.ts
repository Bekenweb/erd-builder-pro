/**
 * Client-side image compression using the Canvas API, without extra dependencies.
 * The server accepts only the result, so every limit here is mirrored server-side (CLD-010 Q7, G3).
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'] as const;
export const IMAGE_INPUT_ACCEPT = ALLOWED_IMAGE_TYPES.join(',');
export const MAX_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_BYTES = 1024 * 1024;
const STAGE_TWO_TARGET_BYTES = 300 * 1024;

interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export type ImageEncoder = (width: number, height: number, type: string, quality: number) => Promise<Blob | null>;

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function asFile(blob: Blob, name: string): File {
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'img';
  return new File([blob], name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type, lastModified: Date.now() });
}

/**
 * Two-stage compression: stage 1 keeps quality high and must land under 1 MB; when it does not,
 * stage 2 lowers quality and size step by step toward about 300 KB. Small files are compressed too,
 * but a result larger than the original is never used.
 */
export async function compressDecodedImage(
  file: File,
  source: { width: number; height: number },
  encode: ImageEncoder,
  options: CompressionOptions = {},
): Promise<File> {
  const { maxWidth = 1280, maxHeight = 1280, quality = 0.85 } = options;
  let size = fitWithin(source.width, source.height, maxWidth, maxHeight);
  const fitsAsIs = size.width === source.width && size.height === source.height;

  // WebP keeps the most quality per byte; browsers without a WebP encoder return PNG, so photos fall back to JPEG.
  const encodeBest = async (width: number, height: number, q: number) => {
    const webp = await encode(width, height, 'image/webp', q);
    if (webp?.type === 'image/webp') return webp;
    return encode(width, height, file.type === 'image/png' ? 'image/png' : 'image/jpeg', q);
  };

  let blob = await encodeBest(size.width, size.height, quality);
  if (!blob) throw new ImageUploadError('The image could not be processed.');
  if (fitsAsIs && blob.size >= file.size && file.size <= MAX_IMAGE_UPLOAD_BYTES) return file;
  if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) return asFile(blob, file.name);

  let stepQuality = quality;
  for (let attempt = 0; attempt < 6 && blob.size > STAGE_TWO_TARGET_BYTES; attempt++) {
    stepQuality = Math.max(0.4, stepQuality - 0.1);
    size = { width: Math.max(1, Math.round(size.width * 0.85)), height: Math.max(1, Math.round(size.height * 0.85)) };
    const next = await encodeBest(size.width, size.height, stepQuality);
    if (next && next.size < blob.size) blob = next;
  }
  if (blob.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ImageUploadError('The image is still larger than 1 MB after compression. Crop it or use a smaller image.');
  }
  return asFile(blob, file.name);
}

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ImageUploadError('The image could not be read.')); };
    img.src = url;
  });
}

/** Validates and compresses an image before upload; throws ImageUploadError with a user-facing message. */
export async function compressImage(file: File, options: CompressionOptions = {}): Promise<File> {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageUploadError('Only JPEG, PNG, WebP or SVG images can be uploaded.');
  }
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageUploadError('The image is larger than 5 MB.');
  }
  // SVG is vector text: drawing it on a canvas would turn it into a raster image.
  if (file.type === 'image/svg+xml') {
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new ImageUploadError('SVG images must be 1 MB or smaller.');
    return file;
  }

  const img = await decode(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageUploadError('The image could not be processed.');

  const encode: ImageEncoder = (width, height, type, quality) => {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  };
  return compressDecodedImage(file, { width: img.naturalWidth, height: img.naturalHeight }, encode, options);
}
