import type { RGBAColor } from "@reveriejs/core";

import type { ExportFormat } from "../../interfaces/encoder/ExportFormat.js";
import type { PNGCompressionLevel } from "../../interfaces/encoder/PNGCompressionLevel.js";

/** Human-readable format names used in diagnostics. */
export const ENCODER_FORMAT_LABELS: Record<ExportFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
};

/** Fully opaque white, used when a JPEG export does not select a background. */
export const OPAQUE_WHITE_RGBA: RGBAColor = {
  r: 255,
  g: 255,
  b: 255,
  a: 255,
};

/** Alpha byte shared by every fully opaque RGBA8 color. */
export const OPAQUE_ALPHA = 255;

/** Highest RGBA8 channel value. */
export const MAX_CHANNEL_VALUE = 255;

/** Deflate level used when a PNG export omits `compressionLevel`. */
export const DEFAULT_PNG_COMPRESSION_LEVEL: PNGCompressionLevel = 6;

/** Lowest deflate level the PNG encoder accepts. */
export const MIN_PNG_COMPRESSION_LEVEL = 0;

/** Highest deflate level the PNG encoder accepts. */
export const MAX_PNG_COMPRESSION_LEVEL = 9;

/** Normalized quality used when a JPEG export omits `quality`. */
export const DEFAULT_JPEG_QUALITY = 0.92;

/** Normalized quality used when a lossy WebP export omits `quality`. */
export const DEFAULT_WEBP_QUALITY = 0.92;

/** Whether a WebP export is lossless unless the caller says otherwise. */
export const DEFAULT_WEBP_LOSSLESS = true;

/** Media type of a PNG export. */
export const PNG_MIME_TYPE = "image/png";

/** Canonical file extension of a PNG export. */
export const PNG_EXTENSION = "png";

/** Media type of a JPEG export. */
export const JPEG_MIME_TYPE = "image/jpeg";

/** Canonical file extension of a JPEG export. */
export const JPEG_EXTENSION = "jpg";

/** Media type of a WebP export. */
export const WEBP_MIME_TYPE = "image/webp";

/** Canonical file extension of a WebP export. */
export const WEBP_EXTENSION = "webp";
