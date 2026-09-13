import type { Coord } from "../Coord.js";

/**
 * An integer coordinate in the world tile grid, where one unit is one tile.
 *
 * Tile `(0, 0)` covers the world pixels from `(0, 0)` to
 * `(tileSize - 1, tileSize - 1)`, and the grid is unbounded in every direction.
 * Negative components identify tiles left of or above the world origin, which is
 * why world pixels are converted with `Math.floor`: at a tile size of 256, world
 * pixel `-1` belongs to tile `-1`, not tile `0`.
 *
 * A tile coordinate is not interchangeable with a pixel coordinate, because one
 * tile step spans `tileSize` pixels.
 */
export interface TileCoord extends Coord {}
