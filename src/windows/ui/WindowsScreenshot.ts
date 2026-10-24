import { createHash } from "node:crypto";
import type { WindowsUiScreenshot } from "./types.js";

/** PNG file signature (8 bytes: 89 50 4E 47 0D 0A 1A 0A). */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Verify that buffer starts with valid PNG magic header. */
export const isPngBuffer = (buffer: Buffer): boolean => {
  if (buffer.length < 8) return false;
  return buffer.subarray(0, 8).equals(PNG_SIGNATURE);
};

/** Read width and height from PNG IHDR chunk (bytes 16..24). */
export const readPngDimensions = (
  buffer: Buffer,
): { width: number; height: number } | undefined => {
  if (!isPngBuffer(buffer) || buffer.length < 24) return undefined;
  // IHDR starts at byte 12 (4 bytes chunk length, 4 bytes "IHDR", 4 bytes width, 4 bytes height)
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return undefined;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
};

/** Create a verified WindowsUiScreenshot from raw PNG byte buffer. */
export const createPngScreenshotRecord = (
  pngBuffer: Buffer,
): WindowsUiScreenshot => {
  const dimensions = readPngDimensions(pngBuffer);
  if (!dimensions) {
    throw new Error("Invalid PNG buffer: missing PNG signature or IHDR chunk.");
  }
  const sha256 = createHash("sha256").update(pngBuffer).digest("hex");
  const base64 = pngBuffer.toString("base64");
  return {
    mime_type: "image/png",
    base64,
    sha256,
    width: dimensions.width,
    height: dimensions.height,
  };
};

/**
 * 1x1 transparent PNG buffer for testing or headless environments where a display surface
 * is detached or mock window capture is requested.
 */
export const MINIMAL_TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
