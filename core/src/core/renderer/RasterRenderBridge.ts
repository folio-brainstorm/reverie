import { RasterTileVersion } from "../../interfaces/renderer/RasterTileVersion.js";
import type { RasterTileView } from "../../interfaces/renderer/RasterTileView.js";
import type { TileCoord } from "../../interfaces/tile/TileCoord.js";
import type { Raster } from "../raster/Raster.js";
import type { Tile } from "../tile/Tile.js";
import type { TileStore } from "../tile/store/TileStore.js";

const RASTER_TILE_STORES = new WeakMap<Raster, TileStore>();
const TILE_PIXEL_BUFFERS = new WeakMap<Tile, Uint8ClampedArray>();
const TILE_WRITE_NOTIFIERS = new WeakMap<
  Tile,
  (x: number, y: number) => void
>();

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
  markPixelWritten: (x: number, y: number) => void,
): void {
  TILE_PIXEL_BUFFERS.set(tile, pixels);
  TILE_WRITE_NOTIFIERS.set(tile, markPixelWritten);
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

/**
 * Reads the stable identity and pixel revision of one allocated Raster tile.
 *
 * This renderer-facing query is independent of `dirtyBounds`, so multiple
 * renderers can observe the same Raster without consuming each other's state.
 *
 * @param raster - Raster whose sparse storage should be inspected.
 * @param coord - Safe-integer coordinate in the Raster tile grid.
 * @returns The current tile version, or `undefined` when the tile is absent.
 */
export function getRasterTileVersion(
  raster: Raster,
  coord: TileCoord,
): RasterTileVersion | undefined {
  const tile = RASTER_TILE_STORES.get(raster)?.get(coord);

  if (tile === undefined) {
    return undefined;
  }

  return { tileId: tile.tileId, revision: tile.revision };
}

/**
 * Reads one allocated Raster tile as a zero-copy view over its live pixels.
 *
 * Unlike {@link getRasterTilePixels}, the returned array is not a snapshot: it
 * aliases the Tile's internal storage, so it must be treated as read-only and
 * must not be retained after the synchronous work that requested it. Copying is
 * left to the caller so bulk readers can extract a region without allocating a
 * full-tile intermediate.
 *
 * @param raster - Raster whose sparse storage should be inspected.
 * @param coord - Safe-integer coordinate in the Raster tile grid.
 * @returns A live tile view, or `undefined` when the tile is absent.
 */
export function getRasterTileView(
  raster: Raster,
  coord: TileCoord,
): RasterTileView | undefined {
  const tile = RASTER_TILE_STORES.get(raster)?.get(coord);

  if (tile === undefined) {
    return undefined;
  }

  const pixels = TILE_PIXEL_BUFFERS.get(tile);

  if (pixels === undefined) {
    return undefined;
  }

  return { tileId: tile.tileId, revision: tile.revision, pixels };
}

/** Returns an allocated tile for trusted, prevalidated world-pixel writes. */
export function getOrCreateRasterTileForTrustedWrite(
  raster: Raster,
  tileX: number,
  tileY: number,
): Tile {
  const tileStore = RASTER_TILE_STORES.get(raster);

  if (tileStore === undefined) {
    throw new Error("Raster internal tile storage is not registered.");
  }

  return tileStore.getOrCreateTrusted(tileX, tileY);
}

/** Returns the mutable buffer registered for a trusted internal tile write. */
export function getTilePixelBufferForTrustedWrite(
  tile: Tile,
): Uint8ClampedArray {
  const pixels = TILE_PIXEL_BUFFERS.get(tile);

  if (pixels === undefined) {
    throw new Error("Tile internal pixel storage is not registered.");
  }

  return pixels;
}

/** Records dirty bounds and revision state after a trusted internal write. */
export function markTrustedTilePixelWritten(
  tile: Tile,
  x: number,
  y: number,
): void {
  const markPixelWritten = TILE_WRITE_NOTIFIERS.get(tile);

  if (markPixelWritten === undefined) {
    throw new Error("Tile internal write notifier is not registered.");
  }

  markPixelWritten(x, y);
}
