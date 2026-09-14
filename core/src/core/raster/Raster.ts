import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type {
  PixelCoord,
  PixelLocation,
} from "../../interfaces/pixel/PixelCoords.js";
import type { RasterConfig } from "../../interfaces/raster/Raster.js";

import { TRANSPARENT_RGBA } from "../../config/color/ColorConstants.js";
import { isRasterPixelWritable } from "../../internal/paint-target/ActiveRasterPaintBounds.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { CoordCoverter } from "../../utils/number/coords/CoordCoverter.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { blendSourceOver } from "../paint/BlendSourceOver.js";
import { registerRasterTileStore } from "../renderer/RasterRenderBridge.js";
import { TileStore } from "../tile/index.js";

const DEFAULT_RASTER_TILE_SIZE = 256;

/**
 * Stores RGBA8 pixels in an unbounded world-coordinate space backed by sparse
 * fixed-size tiles.
 *
 * Tile coordinates, local pixel coordinates, and tile allocation are internal
 * details; callers interact only with world pixels and colors.
 */
export class Raster {
  /** Number of pixels along each immutable tile edge. */
  readonly tileSize: number;

  /** Sparse tile storage owned exclusively by this raster. */
  private readonly tileStore: TileStore;

  // #if DEBUG
  // eslint-disable-next-line jsdoc/require-jsdoc
  get allocatedTileCount(): number {
    return this.tileStore.size;
  }
  // #endif

  /**
   * Creates an empty raster with a fixed tile size.
   *
   * @param config - Optional tile-size override.
   * @throws {ReverieRangeError} `tileSize` is not a positive safe integer.
   */
  constructor(config: RasterConfig = {}) {
    const { tileSize = DEFAULT_RASTER_TILE_SIZE } = config;

    if (!isValidTileSize(tileSize)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
        tileSize,
      });
    }

    this.tileSize = tileSize;
    this.tileStore = new TileStore({
      tileSize,
    });
    registerRasterTileStore(this, this.tileStore);
  }

  /**
   * Reads a world pixel without allocating storage when its tile is absent.
   *
   * @param pixel - Safe-integer coordinate in world-pixel space.
   * @returns A new RGBA8 color object, or transparent black for empty space.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  getPixel(pixel: PixelCoord): RGBAColor {
    const { tile: tileCoord, local: localPixel } =
      this.getLocationByPixel(pixel);
    const tile = this.tileStore.get(tileCoord);

    if (tile === undefined) {
      return { ...TRANSPARENT_RGBA };
    }

    return tile.getPixel(localPixel);
  }

  /**
   * Replaces a world pixel, allocating its tile only when necessary.
   *
   * This operation stores the supplied channels directly and does not perform
   * alpha blending. A transparent write still allocates an absent tile.
   *
   * @param pixel - Safe-integer coordinate in world-pixel space.
   * @param color - RGBA8 channels to store, each an integer from 0 to 255.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} The coordinate is unsafe or a color channel is
   * outside the RGBA8 range.
   */
  setPixel(pixel: PixelCoord, color: RGBAColor): void {
    this.assertValidPixel(pixel);

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    if (!isRasterPixelWritable(this, pixel.x, pixel.y)) {
      return;
    }

    const { tile: tileCoord, local: localPixel } =
      this.locateValidPixel(pixel);

    const tile = this.tileStore.getOrCreate(tileCoord);
    tile.setPixel(localPixel, color);
  }

  /**
   * Composites a source color over a world pixel using straight-alpha Source
   * Over, allocating a tile only when the source can affect the destination.
   *
   * @param pixel - Safe-integer coordinate in world-pixel space.
   * @param color - Straight-alpha RGBA8 source color.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} The coordinate is unsafe or a color channel is
   * outside the RGBA8 range.
   */
  blendPixel(pixel: PixelCoord, color: RGBAColor): void {
    this.assertValidPixel(pixel);

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    if (color.a === 0) {
      return;
    }

    if (!isRasterPixelWritable(this, pixel.x, pixel.y)) {
      return;
    }

    const { tile: tileCoord, local: localPixel } =
      this.locateValidPixel(pixel);

    const tile = this.tileStore.get(tileCoord);
    const destination =
      tile === undefined ? TRANSPARENT_RGBA : tile.getPixel(localPixel);
    const result = blendSourceOver(color, destination);
    const destinationTile = tile ?? this.tileStore.getOrCreate(tileCoord);

    destinationTile.setPixel(localPixel, result);
  }

  /** Removes every allocated tile, returning the raster to empty sparse state. */
  clear(): void {
    this.tileStore.clear();
  }

  /**
   * Validates and maps a public world pixel to its internal tile location.
   *
   * @param pixel - Candidate world-pixel coordinate.
   * @returns The containing tile and its zero-based local pixel coordinate.
   */
  private getLocationByPixel(pixel: PixelCoord): PixelLocation {
    this.assertValidPixel(pixel);
    return this.locateValidPixel(pixel);
  }

  /** Validates a candidate coordinate before any tile mapping or allocation. */
  private assertValidPixel(pixel: PixelCoord): void {
    if (!isValidCoord(pixel)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        pixel,
      );
    }
  }

  /** Maps a previously validated pixel into its containing tile. */
  private locateValidPixel(pixel: PixelCoord): PixelLocation {
    return CoordCoverter.World.locateWorldPixel(pixel, this.tileSize);
  }
}
