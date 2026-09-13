import { TRANSPARENT_RGBA } from "../../config/color/ColorConstants.js";
import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type { Coord } from "../../interfaces/Coord.js";
import type { LocalPixelCoord } from "../../interfaces/pixel/LocalPixelCoord.js";
import type { Rect } from "../../interfaces/pixel/Rect.js";
import type { TileConfig } from "../../interfaces/tile/Tile.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { registerTilePixelBuffer } from "../renderer/RasterRenderBridge.js";

let nextTileId = 1;

/**
 * Stores and tracks a fixed-size block of RGBA8 pixels in tile-local space.
 */
export class Tile {
  /** Stable identity that distinguishes this instance from recreated tiles. */
  readonly tileId: number;

  /** Monotonically increasing version of this tile's pixel state. */
  private currentRevision = 0;

  /** Number of pixels along each immutable tile edge. */
  readonly size: number;

  /** Dense row-major RGBA8 storage containing four channels per pixel. */
  private readonly pixels: Uint8ClampedArray;

  /** Internal pending-change rectangle in half-open tile-local coordinates. */
  private currentDirtyBounds: Rect | null = null;

  /**
   * Returns the smallest tile-local rectangle containing all unprocessed writes.
   *
   * The returned rectangle is a copy so callers cannot mutate Tile state.
   *
   * @returns The dirty rectangle, or `null` when there are no pending changes.
   */
  get dirtyBounds(): Rect | null {
    return this.currentDirtyBounds === null
      ? null
      : { ...this.currentDirtyBounds };
  }

  /** Returns the current pixel-state version without consuming dirty state. */
  get revision(): number {
    return this.currentRevision;
  }

  /**
   * Creates a transparent tile with dense RGBA8 pixel storage.
   *
   * @param config - Configuration containing the positive, safe-integer tile size.
   * @throws {ReverieRangeError} The tile size is not a positive safe integer.
   */
  constructor(config: TileConfig) {
    const { size } = config;

    if (!isValidTileSize(size)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
        tileSize: size,
      });
    }

    this.tileId = nextTileId;
    nextTileId += 1;
    this.size = size;
    this.pixels = new Uint8ClampedArray(size * size * 4);
    registerTilePixelBuffer(this, this.pixels, (x, y) => {
      this.markPixelWritten(x, y);
    });
  }

  /**
   * Reads one pixel from tile-local coordinates without exposing the buffer.
   *
   * @param coord - The integer coordinate within this tile.
   * @returns A new object containing the pixel's RGBA8 channels.
   * @throws {ReverieRangeError} The coordinate is unsafe or outside the tile.
   */
  getPixel(coord: LocalPixelCoord): RGBAColor {
    this.validateCoord(coord);

    return this.getColorByCoord(coord);
  }

  /**
   * Replaces one pixel and expands the pending dirty rectangle to include it.
   *
   * @param coord - The integer coordinate within this tile.
   * @param color - The RGBA8 color to store.
   * @throws {ReverieRangeError} The coordinate is invalid or a color channel is
   * not an integer from 0 to 255.
   */
  setPixel(coord: LocalPixelCoord, color: RGBAColor): void {
    this.validateCoord(coord);

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    this.setColorByCoord(coord, color);
    this.markPixelWritten(coord.x, coord.y);
  }

  /**
   * Clears every pixel to transparent black and marks the entire tile dirty.
   */
  clear(): void {
    this.pixels.fill(0);
    this.currentDirtyBounds = {
      x: 0,
      y: 0,
      width: this.size,
      height: this.size,
    };
    this.currentRevision += 1;
  }

  /**
   * Marks all pending pixel changes as processed.
   */
  resetDirtyBounds(): void {
    this.currentDirtyBounds = null;
  }

  /** Expands the half-open dirty rectangle to include one validated pixel. */
  private markPixelWritten(x: number, y: number): void {
    this.currentRevision += 1;

    if (this.currentDirtyBounds === null) {
      this.currentDirtyBounds = { x, y, width: 1, height: 1 };
      return;
    }

    const right = Math.max(
      this.currentDirtyBounds.x + this.currentDirtyBounds.width,
      x + 1,
    );
    const bottom = Math.max(
      this.currentDirtyBounds.y + this.currentDirtyBounds.height,
      y + 1,
    );
    const left = Math.min(this.currentDirtyBounds.x, x);
    const top = Math.min(this.currentDirtyBounds.y, y);

    this.currentDirtyBounds = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  /** Rejects coordinates that cannot address a pixel in this tile. */
  private validateCoord(coord: LocalPixelCoord): void {
    if (!isValidCoord(coord)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        coord,
      );
    }

    const isOutsideTile =
      coord.x < 0 ||
      coord.x >= this.size ||
      coord.y < 0 ||
      coord.y >= this.size;

    if (isOutsideTile) {
      throw ReverieRangeError.from(
        ErrorDefinitions.TILE.LOCAL_PIXEL_COORDINATE_OUT_OF_BOUNDS,
        { ...coord, tileSize: this.size },
      );
    }
  }

  /** Maps a tile-local coordinate to its first RGBA channel in the buffer. */
  private getPixelBufferOffset(coord: LocalPixelCoord): number {
    return (coord.y * this.size + coord.x) * 4;
  }

  /** Reads a color object from a previously validated coordinate. */
  private getColorByCoord(coord: Coord): RGBAColor {
    return this.getRGBAFromStartIndex(this.getPixelBufferOffset(coord));
  }

  /** Writes a color to a previously validated coordinate. */
  private setColorByCoord(coord: Coord, color: RGBAColor): void {
    this.setRGBAFromStartIndex(this.getPixelBufferOffset(coord), color);
  }

  /** Writes four RGBA channels beginning at a known buffer offset. */
  private setRGBAFromStartIndex(index: number, color: RGBAColor): void {
    this.pixels[index] = color.r;
    this.pixels[index + 1] = color.g;
    this.pixels[index + 2] = color.b;
    this.pixels[index + 3] = color.a;
  }

  /** Copies four RGBA channels beginning at a known buffer offset. */
  private getRGBAFromStartIndex(index: number): RGBAColor {
    return {
      r: this.pixels[index] ?? TRANSPARENT_RGBA.r,
      g: this.pixels[index + 1] ?? TRANSPARENT_RGBA.g,
      b: this.pixels[index + 2] ?? TRANSPARENT_RGBA.b,
      a: this.pixels[index + 3] ?? TRANSPARENT_RGBA.a,
    };
  }
}
