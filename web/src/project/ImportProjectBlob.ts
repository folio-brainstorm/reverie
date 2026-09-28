import type { World } from "@reveriejs/core";

import { importProject } from "@reveriejs/core/project";

/**
 * Reads a browser Blob and imports its `.reverie` bytes as a new independent World.
 *
 * @param blob - Browser binary source; its filename and MIME type are non-authoritative.
 * @returns New World reconstructed from the validated project content.
 * @throws {ReverieError} Core rejects malformed or unsupported project bytes.
 */
export async function importProjectBlob(blob: Blob): Promise<World> {
  return importProject(new Uint8Array(await blob.arrayBuffer()));
}
