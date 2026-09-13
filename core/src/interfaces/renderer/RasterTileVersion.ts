/** Renderer-facing identity and pixel-state version of one allocated tile. */
export interface RasterTileVersion {
  /** Stable identity of the current Tile instance at a coordinate. */
  readonly tileId: number;

  /** Monotonically increasing version of that Tile's pixel state. */
  readonly revision: number;
}
