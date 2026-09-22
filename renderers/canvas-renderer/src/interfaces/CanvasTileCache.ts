/** Cached upload surface and version metadata for one Raster tile coordinate. */
export interface CanvasTileCache {
  /** Tile-sized canvas drawn into the viewport on every visible frame. */
  readonly canvas: HTMLCanvasElement;

  /** Context that owns the reusable ImageData upload. */
  readonly context: CanvasRenderingContext2D;

  /** Reusable RGBA8 upload buffer for the tile. */
  readonly imageData: ImageData;

  /** Identity of the Tile instance represented by the current upload. */
  tileId: number;

  /** Pixel-state revision represented by the current upload. */
  revision: number;

  /** Composition signature represented by a World-composite upload, when used. */
  signature?: string;
}
