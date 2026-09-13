import type { Coord } from "../Coord.js";
import type { TileCoord } from "../tile/TileCoord.js";
import type { LocalPixelCoord } from "./LocalPixelCoord.js";

/**
 * An integer coordinate in unbounded world-pixel space, where one unit is one
 * pixel.
 *
 * Components are measured from the world origin and may be negative in either
 * direction. Every consumer that indexes storage requires both components to be
 * safe integers, which `World.locatePixel` and `Raster` enforce at runtime; this
 * interface does not constrain the numbers itself.
 */
export interface PixelCoord extends Coord {}

/**
 * The tile-grid and tile-local coordinates that identify one world pixel.
 */
export interface PixelLocation {
  /** Coordinate of the tile containing the pixel. */
  tile: TileCoord;

  /** Zero-based coordinate of the pixel inside that tile. */
  local: LocalPixelCoord;
}
