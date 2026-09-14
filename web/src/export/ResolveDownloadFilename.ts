import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebTypeError } from "../errors/WebErrors.js";

/** Base name used when a download request does not supply a filename. */
const DEFAULT_DOWNLOAD_BASE_NAME = "drawing";

/**
 * Resolves the file name a browser download should use.
 *
 * An omitted filename becomes `drawing.<extension>`. A supplied filename keeps
 * its own extension when it has one, so `"artwork.png"` is never turned into
 * `"artwork.png.png"`; a name without an extension gains the encoded image's
 * canonical one. A supplied extension that disagrees with the encoded bytes is
 * preserved verbatim, because the bytes remain authoritative and Step 16C never
 * transcodes.
 *
 * @param filename - Caller-supplied file name, or `undefined` to use the default.
 * @param extension - Canonical extension of the encoded image, without a leading dot.
 * @returns The file name to hand to the browser download.
 * @throws {WebTypeError} `filename` is neither `undefined` nor a non-empty string.
 *
 * @example
 * resolveDownloadFilename(undefined, "png"); // => "drawing.png"
 * resolveDownloadFilename("artwork", "jpg"); // => "artwork.jpg"
 * resolveDownloadFilename("artwork.jpg", "png"); // => "artwork.jpg"
 */
export function resolveDownloadFilename(
  filename: string | undefined,
  extension: string,
): string {
  if (filename === undefined) {
    return `${DEFAULT_DOWNLOAD_BASE_NAME}.${extension}`;
  }

  if (typeof filename !== "string" || filename.length === 0) {
    throw WebTypeError.from(WebErrorDefinitions.INVALID_DOWNLOAD_FILENAME, {
      received: describeFilename(filename),
    });
  }

  return hasFileExtension(filename) ? filename : `${filename}.${extension}`;
}

/**
 * Reports whether a filename already carries its own extension.
 *
 * A leading dot introduces a hidden name rather than an extension, so
 * `".gitignore"` is treated as extension-less and keeps gaining the encoded
 * extension.
 *
 * @param filename - Non-empty file name to inspect.
 * @returns `true` when the name contains a dot after its first character.
 */
function hasFileExtension(filename: string): boolean {
  return filename.lastIndexOf(".") > 0;
}

/**
 * Describes an invalid filename value for a diagnostic message.
 *
 * @param filename - Rejected value, typed as the accepted contract so JavaScript
 * callers that bypass the type system are still described accurately.
 * @returns A short description safe to include in an error message.
 */
function describeFilename(filename: unknown): string {
  return typeof filename === "string" ? "an empty string" : typeof filename;
}
