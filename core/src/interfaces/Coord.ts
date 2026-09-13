/**
 * A two-dimensional Cartesian coordinate whose components are plain numbers.
 *
 * This is the structural base shared by every coordinate kind in the engine and
 * defines no space, unit, or numeric range of its own. `PixelCoord`, `TileCoord`,
 * and `LocalPixelCoord` each name the space their components are measured in,
 * and conversion helpers accept `Coord` when they must work with any space.
 *
 * Those specializations add no members, so they are structurally identical and
 * remain mutually assignable. The compiler therefore cannot detect a coordinate
 * taken from the wrong space, and only the callers' validators reject one at
 * runtime.
 */
export interface Coord {
  /** Horizontal component, increasing to the right. */
  x: number;

  /** Vertical component, increasing downward in raster space. */
  y: number;
}
