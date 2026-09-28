import type { World } from "@reveriejs/core";

import type { WebProjectDownloadOptions } from "../interfaces/project/WebProjectDownloadOptions.js";

import { downloadBlob } from "../export/DownloadBlob.js";
import { createProjectBlob } from "./CreateProjectBlob.js";
import { resolveProjectDownloadFilename } from "./ResolveProjectDownloadFilename.js";

/**
 * Exports a World and triggers a browser download of its editable `.reverie` file.
 *
 * @param world - Runtime World to export without modifying it.
 * @param options - Optional filename and preview supplied by the host product.
 * @throws {ReverieError} Core export or preview validation fails.
 * @throws {WebTypeError} The supplied filename is invalid.
 */
export function downloadProject(
  world: World,
  options: WebProjectDownloadOptions = {},
): void {
  const filename = resolveProjectDownloadFilename(options.filename);
  const blob = createProjectBlob(
    world,
    options.preview === undefined ? {} : { preview: options.preview },
  );
  downloadBlob(blob, filename);
}
