import type { Coord } from "../Coord.js";

/**
 * A zero-based pixel coordinate inside a single tile, measured from that tile's
 * top-left corner.
 *
 * The coordinate addresses one pixel of an already resolved tile, so the same
 * local coordinate identifies different world pixels depending on which
 * `TileCoord` it is combined with. Valid components are integers in the
 * half-open range `[0, tileSize)`, which `Tile` enforces at runtime; this
 * interface does not constrain the numbers itself.
 *
 * The three spaces are related by `world = tile * tileSize + local`.
 */
export interface LocalPixelCoord extends Coord {}
