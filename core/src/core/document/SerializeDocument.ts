import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";
import type { World } from "../world/World.js";

import {
  CURRENT_DOCUMENT_VERSION,
  DOCUMENT_FORMAT,
  MINIMUM_READER_VERSION,
} from "../../config/document/DocumentSchema.js";
import { parseDocument } from "./ParseDocument.js";
import { serializeRaster } from "./SerializeRaster.js";

/**
 * Writes stable World, Layer, and sparse Raster data using the current V1 schema.
 *
 * Session state, renderer data, and history remain outside the document. The
 * result is parsed before return so JavaScript callers cannot emit malformed
 * schema data by mutating runtime fields outside TypeScript.
 *
 * @param world - Runtime document root whose stable metadata should be copied.
 * @returns A fresh normalized V1 serialized document envelope.
 */
export function serializeDocument(world: World): ReverieDocumentV1 {
  return parseDocument({
    id: world.id,
    format: DOCUMENT_FORMAT,
    version: CURRENT_DOCUMENT_VERSION,
    minimumReaderVersion: MINIMUM_READER_VERSION,
    world: {
      tileSize: world.tileSize,
      bounds: world.bounds,
      layers: world.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        raster: serializeRaster(layer.raster),
      })),
    },
  });
}
