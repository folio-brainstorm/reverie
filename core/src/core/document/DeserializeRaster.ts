import type { RasterTileSnapshot } from "../../interfaces/history/RasterTileSnapshot.js";
import type { SerializedRasterV1 } from "../../interfaces/document/SerializedRasterV1.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { Raster } from "../raster/Raster.js";
import { restoreRasterTileSnapshot } from "../renderer/RasterRenderBridge.js";
import { parseRaster } from "./ParseRaster.js";

/**
 * Validates raw V1 Raster data, then restores it into a newly allocated Raster.
 *
 * Validation and payload copies complete before any runtime Raster is created,
 * so a rejected input can never expose a partially restored Raster.
 *
 * @param input - Unknown serialized Raster value.
 * @returns A new Raster with exact sparse RGBA8 tile bytes from the input.
 * @throws {ReverieError} The serialized data is invalid or cannot be restored.
 */
export function deserializeRaster(input: unknown): Raster {
  return hydrateSerializedRaster(parseRaster(input));
}

/**
 * Restores a Raster from already-normalized V1 data without reparsing payloads.
 *
 * This package-internal integration hook is intentionally omitted from the
 * public document entry point. Callers with unknown input must use
 * {@link deserializeRaster} instead.
 *
 * @param serialized - Current schema Raster data already owned by the caller.
 * @returns Fresh Raster with copied sparse RGBA8 tile bytes.
 * @throws {ReverieError} Trusted payload restoration fails unexpectedly.
 */
export function hydrateSerializedRaster(
  serialized: SerializedRasterV1,
): Raster {
  const snapshots = createSnapshots(serialized);
  const raster = new Raster({ tileSize: serialized.tileSize });

  try {
    for (const snapshot of snapshots) {
      restoreRasterTileSnapshot(raster, snapshot);
    }
  } catch (error) {
    const restorationError = ReverieError.from(
      ErrorDefinitions.DOCUMENT.INVALID_RASTER_SCHEMA,
      { reason: "validated Raster payload could not be restored" },
    );
    Object.defineProperty(restorationError, "cause", {
      value: error,
      enumerable: false,
      configurable: true,
    });
    throw restorationError;
  }

  return raster;
}

/** Converts normalized serialized payloads into independent runtime snapshots. */
function createSnapshots(
  serialized: SerializedRasterV1,
): readonly RasterTileSnapshot[] {
  return serialized.tiles.map((tile) => ({
    coord: { x: tile.x, y: tile.y },
    pixels: new Uint8ClampedArray(tile.payload.data),
  }));
}
