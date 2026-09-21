import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";
import type { SerializedLayerV1 } from "../../interfaces/document/SerializedLayerV1.js";
import type { SerializedWorldV1 } from "../../interfaces/document/SerializedWorldV1.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";

import {
  CURRENT_DOCUMENT_VERSION,
  DOCUMENT_FORMAT,
  V1_DOCUMENT_VERSION,
  V1_MINIMUM_READER_VERSION,
} from "../../config/document/DocumentSchema.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { isLayerBlendMode } from "../world/IsLayerBlendMode.js";
import {
  createDocumentSchemaError,
  readRequiredFeatures,
  requirePlainRecord,
} from "./DocumentSchemaGuards.js";
import { parseRaster } from "./ParseRaster.js";

/**
 * Validates current V1 fields and creates a normalized plain document copy.
 *
 * @param input - Candidate serialized V1 document data.
 * @returns Fresh V1 schema data with unknown optional fields removed.
 * @throws {ReverieError} The V1 document schema is malformed or unsupported.
 */
export function parseDocumentV1(input: unknown): ReverieDocumentV1 {
  const envelope = requirePlainRecord(
    input,
    "top-level envelope",
    createDocumentSchemaError,
  );
  if (envelope.format !== DOCUMENT_FORMAT) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_FORMAT);
  }
  if (envelope.version !== V1_DOCUMENT_VERSION) {
    throw ReverieError.from(
      ErrorDefinitions.DOCUMENT.UNSUPPORTED_DOCUMENT_VERSION,
      { version: String(envelope.version) },
    );
  }
  if (
    typeof envelope.minimumReaderVersion !== "number" ||
    !Number.isSafeInteger(envelope.minimumReaderVersion) ||
    envelope.minimumReaderVersion < 1 ||
    envelope.minimumReaderVersion > CURRENT_DOCUMENT_VERSION
  ) {
    throw createDocumentSchemaError(
      "minimumReaderVersion must be a compatible positive safe integer",
    );
  }

  const id = requireStableId(envelope.id, "document id");
  const requiredFeatures = readRequiredFeatures(envelope.requiredFeatures);
  const world = parseWorld(envelope.world);
  return {
    id,
    format: DOCUMENT_FORMAT,
    version: V1_DOCUMENT_VERSION,
    minimumReaderVersion: V1_MINIMUM_READER_VERSION,
    ...(requiredFeatures.length === 0 ? {} : { requiredFeatures }),
    world,
  };
}

/** Validates stable World metadata without constructing a runtime World. */
function parseWorld(input: unknown): SerializedWorldV1 {
  const world = requirePlainRecord(input, "world", createDocumentSchemaError);
  if (!isValidTileSize(world.tileSize)) {
    throw createDocumentSchemaError(
      "world.tileSize must be a positive safe integer",
    );
  }
  const tileSize = world.tileSize;
  const bounds = parseBounds(world.bounds);
  if (!Array.isArray(world.layers) || world.layers.length === 0) {
    throw createDocumentSchemaError("world.layers must be a non-empty array");
  }
  const layerIds = new Set<string>();
  const layers = world.layers.map((layer, index) => {
    const parsedLayer = parseLayer(layer, index, tileSize);
    if (layerIds.has(parsedLayer.id)) {
      throw ReverieError.from(ErrorDefinitions.DOCUMENT.DUPLICATE_LAYER_ID, {
        id: parsedLayer.id,
      });
    }
    layerIds.add(parsedLayer.id);
    return parsedLayer;
  });
  return { tileSize, bounds, layers };
}

/** Validates one Layer's semantic metadata and sparse Raster data. */
function parseLayer(
  input: unknown,
  index: number,
  worldTileSize: number,
): SerializedLayerV1 {
  const layer = requirePlainRecord(
    input,
    `world.layers[${index}]`,
    createDocumentSchemaError,
  );
  const id = requireStableId(layer.id, `world.layers[${index}].id`);
  if (typeof layer.name !== "string") {
    throw createDocumentSchemaError(
      `world.layers[${index}].name must be a string`,
    );
  }
  if (typeof layer.visible !== "boolean") {
    throw createDocumentSchemaError(
      `world.layers[${index}].visible must be a boolean`,
    );
  }
  if (
    typeof layer.opacity !== "number" ||
    !Number.isFinite(layer.opacity) ||
    layer.opacity < 0 ||
    layer.opacity > 1
  ) {
    throw createDocumentSchemaError(
      `world.layers[${index}].opacity must be within [0, 1]`,
    );
  }
  if (
    typeof layer.blendMode !== "string" ||
    !isLayerBlendMode(layer.blendMode)
  ) {
    throw createDocumentSchemaError(
      `world.layers[${index}].blendMode is unsupported`,
    );
  }
  const raster = parseRaster(layer.raster);
  if (raster.tileSize !== worldTileSize) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_RASTER_SCHEMA, {
      reason: `world.layers[${index}].raster.tileSize must match world.tileSize`,
    });
  }
  return {
    id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    raster,
  };
}

/** Validates a finite bounds object or an explicitly unbounded World. */
function parseBounds(input: unknown): WorldBounds | null {
  if (input === null) {
    return null;
  }
  const bounds = requirePlainRecord(
    input,
    "world.bounds",
    createDocumentSchemaError,
  );
  if (
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    throw createDocumentSchemaError(
      "world.bounds must use numeric coordinates and sizes",
    );
  }
  const candidate = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  if (
    !isValidCoord(candidate) ||
    typeof candidate.width !== "number" ||
    !Number.isSafeInteger(candidate.width) ||
    candidate.width <= 0 ||
    typeof candidate.height !== "number" ||
    !Number.isSafeInteger(candidate.height) ||
    candidate.height <= 0
  ) {
    throw createDocumentSchemaError(
      "world.bounds must use safe coordinates and positive sizes",
    );
  }
  return candidate;
}

/** Validates a document or Layer identifier before it becomes normalized data. */
function requireStableId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createDocumentSchemaError(`${field} must be a non-empty string`);
  }
  return value;
}
