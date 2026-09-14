import type { Raster } from "@reverie/core";
import { getRasterTileView } from "@reverie/core/renderer";
import type { TileCoord } from "@reverie/core/renderer";

import { ExporterErrorDefinitions } from "../errors/ExporterErrorDefinitions.js";
import {
  ExporterRangeError,
  ExporterTypeError,
} from "../errors/ExporterErrors.js";
import type { ExportRegion } from "../interfaces/renderer/ExportRegion.js";
import type { ExportRendererConfig } from "../interfaces/renderer/ExportRendererConfig.js";
import type { ExportResult } from "../interfaces/renderer/ExportResult.js";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Extracts dense RGBA8 bitmaps from regions of a sparse Raster.
 *
 * Exporting is explicit and synchronous, and the Raster is only ever read. Each
 * call to {@link render} returns a newly allocated buffer that the caller owns,
 * so results can be encoded, transferred, or discarded independently.
 */
export class ExportRenderer {
  /** Sparse raster observed without allocation or mutation. */
  readonly raster: Raster;

  /**
   * Creates an exporter bound to one Raster.
   *
   * The exporter does not own the lifecycle of the supplied Raster.
   *
   * @param config - The sparse Raster read by every export pass.
   */
  constructor({ raster }: ExportRendererConfig) {
    this.raster = raster;
  }

  /**
   * Extracts a dense RGBA8 bitmap from one world-pixel region of the Raster.
   *
   * The region uses half-open bounds `[x, x + width)` and `[y, y + height)`, and
   * one world pixel maps to exactly one exported pixel. Unallocated tiles and
   * untouched pixels read as transparent black. The Raster itself is never
   * modified, and the returned buffer is a fresh allocation owned by the caller.
   *
   * @param region - World-pixel region to export.
   * @returns A new row-major RGBA8 bitmap with straight alpha.
   * @throws {ExporterTypeError} A region coordinate is not a number.
   * @throws {ExporterRangeError} A coordinate is not a safe integer, an extent is
   * not a positive safe integer, or the region cannot be addressed safely.
   *
   * @example
   * const image = renderer.render({ x: 0, y: 0, width: 1920, height: 1080 });
   * image.pixels.length; // => 1920 * 1080 * 4
   */
  render(region: ExportRegion): ExportResult {
    const { x, y, width, height } = region;

    assertSafeCoordinate(x, "x");
    assertSafeCoordinate(y, "y");
    assertPositiveSafeInteger(width, "width");
    assertPositiveSafeInteger(height, "height");
    assertRegionWithinSafeRange(x, y, width, height);

    const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);

    copyIntersectingTiles(this.raster, { x, y, width, height }, pixels);

    return { width, height, pixels };
  }
}

/**
 * Validates a world-pixel coordinate from an untrusted region.
 *
 * @param value - Candidate coordinate.
 * @param param - Field name used in the error message.
 * @throws {ExporterTypeError} `value` is not a number.
 * @throws {ExporterRangeError} `value` is not a safe integer.
 */
function assertSafeCoordinate(value: unknown, param: string): void {
  if (typeof value !== "number") {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_REGION_FIELD_TYPE,
      { param, received: typeof value },
    );
  }

  if (!Number.isSafeInteger(value)) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_REGION_COORDINATE,
      { param, received: value },
    );
  }
}

/**
 * Validates a world-pixel extent from an untrusted region.
 *
 * @param value - Candidate extent.
 * @param param - Field name used in the error message.
 * @throws {ExporterRangeError} `value` is not a positive safe integer.
 */
function assertPositiveSafeInteger(value: unknown, param: string): void {
  if (typeof value !== "number") {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_REGION_SIZE,
      { param, received: typeof value },
    );
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_REGION_SIZE,
      { param, received: value },
    );
  }
}

/**
 * Rejects regions whose derived offsets, pixel count, or byte length are no
 * longer safe integers.
 *
 * The check runs before allocation so that an unusable region fails with a
 * stable coded error instead of a native TypedArray construction failure.
 *
 * @param x - Validated left edge.
 * @param y - Validated top edge.
 * @param width - Validated horizontal extent.
 * @param height - Validated vertical extent.
 * @throws {ExporterRangeError} A derived value is not a safe integer.
 */
function assertRegionWithinSafeRange(
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const isHorizontalEndSafe = Number.isSafeInteger(x + width);
  const isVerticalEndSafe = Number.isSafeInteger(y + height);
  const pixelCount = width * height;
  const isPixelCountSafe = Number.isSafeInteger(pixelCount);
  const isByteLengthSafe = Number.isSafeInteger(
    pixelCount * RGBA_CHANNEL_COUNT,
  );

  if (
    !isHorizontalEndSafe ||
    !isVerticalEndSafe ||
    !isPixelCountSafe ||
    !isByteLengthSafe
  ) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.REGION_EXCEEDS_SAFE_RANGE,
      { x, y, width, height },
    );
  }
}

/**
 * Copies every allocated tile that intersects the region into the output.
 *
 * The output buffer starts zeroed, so absent tiles already represent transparent
 * black and are skipped without allocating storage.
 *
 * @param raster - Raster read without mutation.
 * @param region - Validated world-pixel region.
 * @param output - Pre-zeroed row-major RGBA8 destination.
 */
function copyIntersectingTiles(
  raster: Raster,
  region: ExportRegion,
  output: Uint8ClampedArray,
): void {
  const { tileSize } = raster;
  const minTileX = Math.floor(region.x / tileSize);
  const maxTileX = Math.floor((region.x + region.width - 1) / tileSize);
  const minTileY = Math.floor(region.y / tileSize);
  const maxTileY = Math.floor((region.y + region.height - 1) / tileSize);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const tileCoord: TileCoord = { x: tileX, y: tileY };
      const tileView = getRasterTileView(raster, tileCoord);

      if (tileView === undefined) {
        continue;
      }

      copyTileIntersection(
        tileView.pixels,
        tileSize,
        tileCoord,
        region,
        output,
      );
    }
  }
}

/**
 * Copies one scanline at a time from a tile's live pixels into the output.
 *
 * Only the overlapping sub-rectangle is read, so a tile is never copied in full
 * and negative tile coordinates are handled by their derived world offsets.
 *
 * @param tilePixels - Live row-major RGBA8 storage of the source tile.
 * @param tileSize - Pixels along each tile edge.
 * @param tile - Tile grid coordinate of the source tile.
 * @param region - Validated world-pixel region.
 * @param output - Pre-zeroed row-major RGBA8 destination.
 */
function copyTileIntersection(
  tilePixels: Uint8ClampedArray,
  tileSize: number,
  tile: TileCoord,
  region: ExportRegion,
  output: Uint8ClampedArray,
): void {
  const tileWorldX = tile.x * tileSize;
  const tileWorldY = tile.y * tileSize;
  const startX = Math.max(region.x, tileWorldX);
  const endX = Math.min(region.x + region.width, tileWorldX + tileSize);
  const startY = Math.max(region.y, tileWorldY);
  const endY = Math.min(region.y + region.height, tileWorldY + tileSize);

  if (startX >= endX || startY >= endY) {
    return;
  }

  const rowByteLength = (endX - startX) * RGBA_CHANNEL_COUNT;
  const localStartX = startX - tileWorldX;
  const exportStartX = startX - region.x;

  for (let worldY = startY; worldY < endY; worldY += 1) {
    const localY = worldY - tileWorldY;
    const exportY = worldY - region.y;
    const srcOffset = (localY * tileSize + localStartX) * RGBA_CHANNEL_COUNT;
    const dstOffset =
      (exportY * region.width + exportStartX) * RGBA_CHANNEL_COUNT;

    output.set(
      tilePixels.subarray(srcOffset, srcOffset + rowByteLength),
      dstOffset,
    );
  }
}
