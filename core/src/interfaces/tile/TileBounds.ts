/**
 * Inclusive minimum and maximum coordinates of Tiles allocated in sparse
 * storage.
 */
export interface TileBounds {
  /** Smallest allocated horizontal Tile coordinate. */
  minX: number;

  /** Smallest allocated vertical Tile coordinate. */
  minY: number;

  /** Largest allocated horizontal Tile coordinate. */
  maxX: number;

  /** Largest allocated vertical Tile coordinate. */
  maxY: number;
}
