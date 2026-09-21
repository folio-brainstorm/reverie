import type { SerializedRasterV1 } from "../../interfaces/document/SerializedRasterV1.js";
import type { Raster } from "../raster/Raster.js";

import { getAllocatedRasterTileSnapshots } from "../renderer/RasterRenderBridge.js";

/**
 * Creates an independent, sparse V1 representation of a Raster's RGBA8 tiles.
 *
 * Tile records are ordered by tile-Y then tile-X so equivalent Raster state
 * always serializes in the same order. Tile identity, revisions, and dirty
 * state are renderer implementation details and are intentionally excluded.
 *
 * @param raster - Raster whose allocated tiles should be copied.
 * @returns A fresh raw RGBA8 schema object with no buffers shared with `raster`.
 */
export function serializeRaster(raster: Raster): SerializedRasterV1 {
  const tiles = [];
  for (const snapshot of getAllocatedRasterTileSnapshots(raster)) {
    if (snapshot.pixels === null) {
      continue;
    }
    tiles.push({
      x: snapshot.coord.x,
      y: snapshot.coord.y,
      payload: {
        encoding: "rgba8-raw" as const,
        data: new Uint8Array(snapshot.pixels),
      },
    });
  }
  tiles.sort((left, right) => left.y - right.y || left.x - right.x);

  return {
    tileSize: raster.tileSize,
    pixelFormat: "rgba8",
    tiles,
  };
}
