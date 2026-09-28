import type { World } from "@reveriejs/core";
import type { ProjectExportOptions } from "@reveriejs/core/project";

import { exportProject } from "@reveriejs/core/project";

import { PROJECT_MIME_TYPE } from "../config/project/ProjectFile.js";
import { createBinaryBlob } from "../export/CreateBinaryBlob.js";

/**
 * Captures a World as a browser-native Reverie project Blob.
 *
 * @param world - Runtime World to export as an editable project.
 * @param options - Optional Core project-export data, including a preview.
 * @returns A Blob with the Reverie project media type and exact Core bytes.
 * @throws {ReverieError} Core export rejects an empty or invalid document.
 */
export function createProjectBlob(
  world: World,
  options: ProjectExportOptions = {},
): Blob {
  return createBinaryBlob(exportProject(world, options), PROJECT_MIME_TYPE);
}
