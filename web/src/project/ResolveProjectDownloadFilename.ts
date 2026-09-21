import { PROJECT_FILE_EXTENSION } from "../config/project/ProjectFile.js";
import { resolveDownloadFilename } from "../export/ResolveDownloadFilename.js";

/** Base name used when a project download does not supply a filename. */
const DEFAULT_PROJECT_DOWNLOAD_BASE_NAME = "Untitled";

/**
 * Resolves a conservative project download filename with the canonical extension.
 *
 * @param filename - Caller-supplied filename, or `undefined` for the V1 default.
 * @returns Browser download filename with `.reverie` when no extension was supplied.
 * @throws {WebTypeError} The filename is not a non-empty string when specified.
 */
export function resolveProjectDownloadFilename(
  filename: string | undefined,
): string {
  return resolveDownloadFilename(
    filename,
    PROJECT_FILE_EXTENSION,
    DEFAULT_PROJECT_DOWNLOAD_BASE_NAME,
  );
}
