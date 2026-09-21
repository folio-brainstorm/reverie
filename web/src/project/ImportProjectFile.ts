import type { World } from "@reverie/core";

import { importProjectBlob } from "./ImportProjectBlob.js";

/**
 * Imports a browser File as a new independent World.
 *
 * @param file - Selected browser file; content, not extension or filename, is authoritative.
 * @returns New World reconstructed from the validated project bytes.
 * @throws {ReverieError} Core rejects malformed or unsupported project bytes.
 */
export async function importProjectFile(file: File): Promise<World> {
  return importProjectBlob(file);
}
