/**
 * web/lib/pfpValidation.ts — server-side validation + normalization for
 * Task 4's PFP upload. Never trusts the client's own crop/format claims:
 * the client may crop to square for UX, but this always re-crops and
 * re-encodes regardless, which is also what strips EXIF/ICC/metadata (a
 * re-encode only carries pixel data forward unless told otherwise).
 */

export const MAX_PFP_BYTES = 512 * 1024;

export type ImageFormat = "png" | "jpeg" | "webp";

// Sniffs the actual file format from its magic bytes — deliberately NOT
// trusting the browser-supplied MIME type/Content-Type header, both of
// which are trivially spoofable by whoever is making the request.
export function sniffImageFormat(bytes: Buffer): ImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

export type PfpProcessResult =
  | { ok: true; processed: Buffer; ext: string; contentType: string }
  | { ok: false; error: string };

export async function processPfpUpload(bytes: Buffer): Promise<PfpProcessResult> {
  if (bytes.length === 0) return { ok: false, error: "empty file" };
  if (bytes.length > MAX_PFP_BYTES) {
    return { ok: false, error: `image exceeds the ${MAX_PFP_BYTES / 1024}KB limit` };
  }

  const format = sniffImageFormat(bytes);
  if (!format) {
    return { ok: false, error: "unrecognized image format — must be PNG, JPEG, or WEBP (checked by file content, not the claimed content type)" };
  }

  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;

  let meta;
  try {
    meta = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    return { ok: false, error: "could not decode image — file may be corrupt or truncated" };
  }
  if (!meta.width || !meta.height) return { ok: false, error: "could not read image dimensions" };

  const side = Math.min(meta.width, meta.height);
  const left = Math.floor((meta.width - side) / 2);
  const top = Math.floor((meta.height - side) / 2);

  try {
    // Center-crop to square, always re-encoded to PNG regardless of the
    // input format — a fresh encode from decoded pixels is what strips
    // EXIF/ICC/XMP metadata; PNG also gives every uploaded PFP one
    // consistent, predictable output format to store and serve.
    const processed = await sharp(bytes).extract({ left, top, width: side, height: side }).png().toBuffer();
    return { ok: true, processed, ext: "png", contentType: "image/png" };
  } catch {
    return { ok: false, error: "failed to process image" };
  }
}

export function isValidDisplayName(name: string): boolean {
  if (name.length === 0 || name.length > 24) return false;
  // Restricted charset: alphanumerics, space, hyphen, underscore — enough
  // for a readable handle, narrow enough to rule out control characters,
  // markup, or anything that could break rendering elsewhere in the app.
  return /^[a-zA-Z0-9 _-]+$/.test(name);
}

export function sanitizeDisplayName(name: string): string {
  return name.trim().slice(0, 24);
}
