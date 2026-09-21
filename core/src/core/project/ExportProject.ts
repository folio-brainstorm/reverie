import type { ProjectExportOptions } from "../../interfaces/project/ProjectExportOptions.js";
import type { World } from "../world/World.js";

import { serializeDocument } from "../document/SerializeDocument.js";
import { encodeNormalizedProjectContainer } from "./EncodeProjectContainer.js";

/**
 * Captures a World as a portable, self-contained `.reverie` project payload.
 *
 * The source World is read only. Its document snapshot is fully captured before
 * physical container encoding begins, so later edits cannot affect the result.
 *
 * @param world - Runtime World whose editable Raster document should be exported.
 * @param options - Optional non-authoritative preview supplied by the host product.
 * @returns Complete project-container bytes, with no filename or storage ownership.
 * @throws {ReverieError} The World, preview, or resulting project is invalid.
 */
export function exportProject(
  world: World,
  options: ProjectExportOptions = {},
): Uint8Array {
  return encodeNormalizedProjectContainer(serializeDocument(world), options);
}
