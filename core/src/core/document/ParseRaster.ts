import type { SerializedRasterTileV1 } from "../../interfaces/document/SerializedRasterTileV1.js";
import type { SerializedRasterV1 } from "../../interfaces/document/SerializedRasterV1.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import {
  createRasterSchemaError,
  requirePlainRecord,
} from "./DocumentSchemaGuards.js";

/**
 * Validates and normalizes a sparse V1 Raster schema object without allocating
 * a runtime Raster. Every accepted tile payload is copied before return.
 *
 * @param input - Unknown serialized Raster value.
 * @returns A fresh V1 Raster schema object with independently owned payloads.
 * @throws {ReverieError} The Raster schema, format, tile coordinates, or bytes are invalid.
 */
export function parseRaster(input: unknown): SerializedRasterV1 {
  const raster = requirePlainRecord(input, "raster", createRasterSchemaError);
  const tileSize = raster.tileSize;
  if (!isValidTileSize(tileSize)) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.UNSUPPORTED_TILE_SIZE, {
      tileSize: String(tileSize),
    });
  }
  if (raster.pixelFormat !== "rgba8") {
    throw ReverieError.from(
      ErrorDefinitions.DOCUMENT.UNSUPPORTED_PIXEL_FORMAT,
      { pixelFormat: String(raster.pixelFormat) },
    );
  }
  if (!Array.isArray(raster.tiles)) {
    throw createRasterSchemaError("raster.tiles must be an array");
  }

  const expectedPayloadLength = getExpectedPayloadLength(tileSize);
  const coordinates = new Set<string>();
  const tiles = raster.tiles.map((tile, index) => {
    const parsedTile = parseTile(tile, index, expectedPayloadLength);
    const coordinateKey = `${parsedTile.x}:${parsedTile.y}`;
    if (coordinates.has(coordinateKey)) {
      throw ReverieError.from(
        ErrorDefinitions.DOCUMENT.DUPLICATE_TILE_COORDINATE,
        { x: parsedTile.x, y: parsedTile.y },
      );
    }
    coordinates.add(coordinateKey);
    return parsedTile;
  });

  return { tileSize, pixelFormat: "rgba8", tiles };
}

/** Validates one allocated sparse tile and copies its raw bytes. */
function parseTile(
  input: unknown,
  index: number,
  expectedPayloadLength: number,
): SerializedRasterTileV1 {
  const tile = requirePlainRecord(
    input,
    `raster.tiles[${index}]`,
    createRasterSchemaError,
  );
  if (!isSafeInteger(tile.x) || !isSafeInteger(tile.y)) {
    throw createRasterSchemaError(
      `raster.tiles[${index}] coordinates must be safe integers`,
    );
  }
  const payload = requirePlainRecord(
    tile.payload,
    `raster.tiles[${index}].payload`,
    createRasterSchemaError,
  );
  if (payload.encoding !== "rgba8-raw") {
    throw ReverieError.from(
      ErrorDefinitions.DOCUMENT.UNSUPPORTED_RASTER_ENCODING,
      { encoding: String(payload.encoding) },
    );
  }
  if (!(payload.data instanceof Uint8Array)) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_TILE_PAYLOAD, {
      index,
      expected: expectedPayloadLength,
      received: "non-Uint8Array",
    });
  }
  if (payload.data.length !== expectedPayloadLength) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_TILE_PAYLOAD, {
      index,
      expected: expectedPayloadLength,
      received: payload.data.length,
    });
  }
  return {
    x: tile.x,
    y: tile.y,
    payload: { encoding: "rgba8-raw", data: new Uint8Array(payload.data) },
  };
}

/** Returns a safe exact raw byte count for one tile or rejects unusable sizes. */
function getExpectedPayloadLength(tileSize: number): number {
  const expectedPayloadLength = tileSize * tileSize * 4;
  if (!Number.isSafeInteger(expectedPayloadLength)) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.UNSUPPORTED_TILE_SIZE, {
      tileSize,
    });
  }
  return expectedPayloadLength;
}

/** Narrows unknown coordinate values to values safe for the sparse tile grid. */
function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
