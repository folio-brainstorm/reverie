import type { TileCoord } from "../../interfaces/tile/TileCoord.js";
import type { Raster } from "../raster/Raster.js";
import type { Tile } from "../tile/Tile.js";
import type { TileStore } from "../tile/store/TileStore.js";

const RASTER_TILE_STORES = new WeakMap<Raster, TileStore>();
const TILE_PIXEL_BUFFERS = new WeakMap<Tile, Uint8ClampedArray>();

/**
 * Registers the private TileStore owned by a Raster instance.
 *
 * This is a package-internal integration hook and is not exported through an
 * `@reverie/core` package entry point.
 *
 * @param raster - Raster that owns the store.
 * @param tileStore - Private sparse storage owned by the Raster.
 */
export function registerRasterTileStore(
  raster: Raster,
  tileStore: TileStore,
): void {
  RASTER_TILE_STORES.set(raster, tileStore);
}

/**
 * Registers the private RGBA8 storage owned by a Tile instance.
 *
 * This is a package-internal integration hook and is not exported through an
 * `@reverie/core` package entry point.
 *
 * @param tile - Tile that owns the pixel storage.
 * @param pixels - Mutable storage that remains owned exclusively by the Tile.
 */
export function registerTilePixelBuffer(
  tile: Tile,
  pixels: Uint8ClampedArray,
): void {
  TILE_PIXEL_BUFFERS.set(tile, pixels);
}

/**
 * Reads one allocated Raster tile as an independent RGBA8 snapshot.
 *
 * Missing tiles return `undefined` without allocating storage. Mutating a
 * returned array cannot change the Raster or a later snapshot.
 *
 * @param raster - Raster whose sparse storage should be inspected.
 * @param coord - Safe-integer coordinate in the Raster tile grid.
 * @returns A fresh row-major RGBA8 copy, or `undefined` when the tile is absent.
 * @throws {ReverieTypeError} A coordinate component is not a number.
 * @throws {ReverieRangeError} A coordinate component is not a safe integer.
 */
export function getRasterTilePixels(
  raster: Raster,
  coord: TileCoord,
): Uint8ClampedArray | undefined {
  const tileStore = RASTER_TILE_STORES.get(raster);

  if (tileStore === undefined) {
    return undefined;
  }

  const tile = tileStore.get(coord);

  if (tile === undefined) {
    return undefined;
  }

  return TILE_PIXEL_BUFFERS.get(tile)?.slice();
}
