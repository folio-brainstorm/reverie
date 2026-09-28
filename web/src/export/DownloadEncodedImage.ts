import type { EncodedImage } from "@reveriejs/exporter";

import type { DownloadImageOptions } from "../interfaces/export/DownloadImageOptions.js";

import { assertDownloadableImage } from "./AssertDownloadableImage.js";
import { createBinaryBlob } from "./CreateBinaryBlob.js";
import { downloadBlob } from "./DownloadBlob.js";
import { resolveDownloadFilename } from "./ResolveDownloadFilename.js";

/**
 * Delivers an encoded image to the user through a browser download.
 *
 * The bytes are wrapped in a `Blob` typed by `image.mimeType`, exposed through a
 * temporary object URL, and clicked through a hidden anchor appended to the
 * document. The object URL is always revoked on a later task, even when anchor
 * interaction throws, so a failed download cannot leak it.
 *
 * This helper is deliberately browser-only and lives in `@reveriejs/web`. It never
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
  downloadBlob(createBinaryBlob(image.data, image.mimeType), filename);
}
