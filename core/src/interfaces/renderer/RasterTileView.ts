import type { RasterTileVersion } from "./RasterTileVersion.js";

/**
 * Renderer-facing view over one allocated tile's live RGBA8 storage.
 *
 * The view carries the same stable identity and revision state as
 * {@link RasterTileVersion} and additionally exposes the tile's pixel array
 * without copying it. The array aliases the Tile's internal storage, so readers
 * must treat it as read-only and must not retain it beyond the synchronous work
 * that requested it.
 */
export interface RasterTileView extends RasterTileVersion {
  /** Row-major RGBA8 storage owned by the Tile; read-only by contract. */
  readonly pixels: Uint8ClampedArray;
}
