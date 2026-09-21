import type { DocumentReadOptions } from "../../interfaces/document/DocumentReadOptions.js";
import type { World } from "../world/World.js";

import { hydrateDocumentV1 } from "../document/DeserializeDocument.js";
import { decodeProjectContainer } from "./DecodeProjectContainer.js";

/**
 * Imports a complete `.reverie` project payload into a new independent World.
 *
 * Physical container validation and document normalization complete before
 * runtime state is hydrated. The normalized document is hydrated directly so
 * importing a project does not parse or copy Raster payloads twice.
 *
 * @param data - Untrusted raw `.reverie` project bytes.
 * @param options - Reader capabilities used to validate required document features.
 * @returns A fully hydrated World that owns its Raster state independently.
 * @throws {ReverieError} The project container or embedded document is invalid.
 */
export function importProject(
  data: Uint8Array,
  options: DocumentReadOptions = {},
): World {
  return hydrateDocumentV1(decodeProjectContainer(data, options));
}
