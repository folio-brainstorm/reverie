import type { Coord } from "../../../interfaces/Coord.js";
import type { LocalPixelCoord } from "../../../interfaces/pixel/LocalPixelCoord.js";
import type { PixelLocation } from "../../../interfaces/pixel/PixelCoords.js";
import type { TileCoord } from "../../../interfaces/tile/TileCoord.js";

import { ErrorDefinitions } from "../../errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../errors/ReverieErrors.js";

/**
 * Ensures coordinate conversion never divides by zero or an invalid grid size.
 *
 * @param tileSize - Candidate number of pixels along one tile edge.
 * @throws {ReverieRangeError} The size is not a positive safe integer.
 */
function assertValidTileSize(tileSize: number): void {
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0) {
    throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
      tileSize,
    });
  }
}

/** Coordinate conversions between the world grid and its tile grid. */
export namespace CoordCoverter {
  /** Conversions whose input is expressed in world-pixel coordinates. */
  export namespace World {
    /**
     * Resolves the tile containing a world pixel.
     *
     * `Math.floor` is required for negative coordinates: world pixel `-1`
     * belongs to tile `-1`, rather than tile `0`.
     *
     * @param coord - A world-pixel coordinate.
     * @param tileSize - The positive number of pixels along one tile edge.
     * @returns The coordinate of the tile containing `coord`.
     * @throws {RangeError} When `tileSize` is not a positive safe integer.
     */
    export function worldCoordToTileCoord(
      coord: Coord,
      tileSize: number,
    ): TileCoord {
      assertValidTileSize(tileSize);

      return {
        x: Math.floor(coord.x / tileSize),
        y: Math.floor(coord.y / tileSize),
      };
    }

    /**
     * Converts a world coordinate to its offset inside an already resolved tile.
     *
     * The subtraction form is intentionally used instead of JavaScript's `%`:
     * `%` returns a negative remainder for negative operands, while a local pixel
     * must always be within the half-open interval `[0, tileSize)`.
     *
     * @param worldCoord - Pixel coordinate in world space.
     * @param tileCoord - Coordinate of the tile containing the world pixel.
     * @param tileSize - Number of pixels along one tile edge.
     * @returns The zero-based pixel coordinate relative to the tile origin.
     */
    function tileCoordToLocalPixelCoord(
      worldCoord: Coord,
      tileCoord: TileCoord,
      tileSize: number,
    ): LocalPixelCoord {
      return {
        x: worldCoord.x - tileCoord.x * tileSize,
        y: worldCoord.y - tileCoord.y * tileSize,
      };
    }

    /**
     * Resolves a world pixel's zero-based offset inside its tile.
     *
     * For `{ x: -257, y: 300 }` with a tile size of `256`, the containing tile
     * is `{ x: -2, y: 1 }`, producing local coordinate `{ x: 255, y: 44 }`.
     * For every valid input, each returned component is in `[0, tileSize)`.
     *
     * @param coord - A world-pixel coordinate.
     * @param tileSize - The positive number of pixels along one tile edge.
     * @returns The pixel coordinate relative to the containing tile's origin.
     * @throws {RangeError} When `tileSize` is not a positive safe integer.
     */
    export function worldCoordToLocalPixelCoord(
      coord: Coord,
      tileSize: number,
    ): LocalPixelCoord {
      const tileCoord = worldCoordToTileCoord(coord, tileSize);

      return tileCoordToLocalPixelCoord(coord, tileCoord, tileSize);
    }

    /**
     * Resolves both parts of a world-pixel location with one tile calculation.
     *
     * @param coord - A world-pixel coordinate.
     * @param tileSize - The positive number of pixels along one tile edge.
     * @returns The containing tile and the pixel's local coordinate within it.
     * @throws {RangeError} When `tileSize` is not a positive safe integer.
     */
    export function locateWorldPixel(
      coord: Coord,
      tileSize: number,
    ): PixelLocation {
      const tile = worldCoordToTileCoord(coord, tileSize);

      return {
        tile,
        local: tileCoordToLocalPixelCoord(coord, tile, tileSize),
      };
    }
  }
}
