import type { DocumentReadOptions } from "../../interfaces/document/DocumentReadOptions.js";
import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { RasterLayer } from "../world/RasterLayer.js";
import { World } from "../world/World.js";
import { hydrateSerializedRaster } from "./DeserializeRaster.js";
import { parseDocument } from "./ParseDocument.js";

/**
 * Normalizes supported serialized input and hydrates a fresh runtime World.
 *
 * Historical compatibility handling finishes in {@link parseDocument}; runtime
 * objects receive current V1 schema data only. A failed hydration never mutates
 * an existing World or returns the partially constructed local World.
 *
 * @param input - Unknown in-memory serialized document value.
 * @param options - Reader capabilities used while normalizing required features.
 * @returns A fresh World with stable IDs, ordered Layers, and sparse Raster bytes restored.
 * @throws {ReverieError} The input is unsupported, malformed, or cannot hydrate.
 */
export function deserializeDocument(
  input: unknown,
  options: DocumentReadOptions = {},
): World {
  const document = parseDocument(input, options);
  return hydrateDocumentV1(document);
}

/**
 * Hydrates runtime state from an already-normalized V1 document snapshot.
 *
 * This package-internal integration hook preserves the same hydration error
 * boundary as {@link deserializeDocument}. Unknown input must use
 * {@link deserializeDocument} instead.
 *
 * @param document - Current V1 data already normalized by the document pipeline.
 * @returns A fresh World that owns independent Raster state.
 * @throws {ReverieError} Validated data cannot be hydrated into runtime objects.
 */
export function hydrateDocumentV1(document: ReverieDocumentV1): World {
  try {
    return createRuntimeWorld(document);
  } catch (cause) {
    const error = ReverieError.from(
      ErrorDefinitions.DOCUMENT.DOCUMENT_HYDRATION_FAILED,
    );
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
    });
    throw error;
  }
}

/** Hydrates one already-normalized V1 document through public runtime APIs. */
function createRuntimeWorld(document: ReverieDocumentV1): World {
  const layers = document.world.layers.map((serializedLayer) => {
    const layer = new RasterLayer(
      hydrateSerializedRaster(serializedLayer.raster),
      document.world.bounds,
      serializedLayer.id,
    );
    layer.name = serializedLayer.name;
    layer.visible = serializedLayer.visible;
    layer.opacity = serializedLayer.opacity;
    layer.blendMode = serializedLayer.blendMode;
    return layer;
  });

  return new World({
    id: document.id,
    tileSize: document.world.tileSize,
    bounds: document.world.bounds,
    initialLayers: layers,
  });
}
