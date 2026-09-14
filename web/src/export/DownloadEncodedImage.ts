import type { EncodedImage } from "@reverie/exporter";

import type { DownloadImageOptions } from "../interfaces/export/DownloadImageOptions.js";

import { assertDownloadableImage } from "./AssertDownloadableImage.js";
import { resolveDownloadFilename } from "./ResolveDownloadFilename.js";

/** Delay before a temporary object URL is revoked, in milliseconds. */
const OBJECT_URL_REVOCATION_DELAY_MS = 0;

/**
 * Delivers an encoded image to the user through a browser download.
 *
 * The bytes are wrapped in a `Blob` typed by `image.mimeType`, exposed through a
 * temporary object URL, and clicked through a hidden anchor appended to the
 * document. The object URL is always revoked on a later task, even when anchor
 * interaction throws, so a failed download cannot leak it.
 *
 * This helper is deliberately browser-only and lives in `@reverie/web`. It never
 * reads a Raster, renders, or selects an encoder, and it never modifies the
 * supplied bytes.
 *
 * @param image - Encoded file to download, including its media type and extension.
 * @param options - Optional download behavior; omitted values use defaults.
 * @throws {WebTypeError} `image` is not a valid encoded image, or `filename` is
 * not a non-empty string.
 * @throws {WebRangeError} `image.data` contains no bytes.
 *
 * @example
 * downloadEncodedImage(image, { filename: "artwork" });
 */
export function downloadEncodedImage(
  image: EncodedImage,
  options?: DownloadImageOptions,
): void {
  assertDownloadableImage(image);

  const filename = resolveDownloadFilename(options?.filename, image.extension);
  const objectUrl = createObjectUrl(image);

  try {
    triggerAnchorDownload(objectUrl, filename);
  } finally {
    scheduleObjectUrlRevocation(objectUrl);
  }
}

/**
 * Wraps encoded bytes in a Blob and registers a temporary object URL.
 *
 * The media type comes from the encoded image rather than from its filename
 * extension, so the bytes stay the single source of truth.
 *
 * @param image - Validated encoded file.
 * @returns A new object URL backed by the encoded bytes.
 */
function createObjectUrl(image: EncodedImage): string {
  // `BlobPart` requires an `ArrayBuffer`-backed view, while an encoder's bytes
  // may be typed against a `SharedArrayBuffer`; this copy produces the plain
  // `Uint8Array<ArrayBuffer>` the Blob constructor accepts.
  const bytes = new Uint8Array(image.data);
  const blob = new Blob([bytes], { type: image.mimeType });

  return URL.createObjectURL(blob);
}

/**
 * Clicks a temporary anchor that asks the browser to save the object URL.
 *
 * The anchor is appended before clicking, because some browsers ignore a click
 * on a detached node, and removed in a `finally` so no temporary DOM node
 * outlives the download even when the click itself fails.
 *
 * @param objectUrl - Object URL resolving to the encoded bytes.
 * @param filename - File name the browser should propose.
 */
function triggerAnchorDownload(objectUrl: string, filename: string): void {
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

/**
 * Revokes an object URL on a later task.
 *
 * Revoking synchronously can cancel a download the browser has not started yet,
 * so the call is deferred until after the current task completes.
 *
 * @param objectUrl - Object URL that must not outlive the download.
 */
function scheduleObjectUrlRevocation(objectUrl: string): void {
  setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    OBJECT_URL_REVOCATION_DELAY_MS,
  );
}
