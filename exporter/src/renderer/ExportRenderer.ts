import type { LayerBlendMode, Raster } from "@reverie/core";
import {
  getRasterTileView,
  getWorldCompositionLayers,
  compositeRgbaSourceOverInPlace,
  intersectRenderRegion,
  resolveRenderSource,
} from "@reverie/core/rendering/internal";
import type { TileCoord } from "@reverie/core/rendering";
import type { RenderSourceSnapshot } from "@reverie/core/rendering/internal";

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
 * Extracts dense straight-alpha RGBA8 bitmaps from Raster or composed World regions.
 *
 * The exporter owns neither the supplied source (Raster or World) nor its layers;
 * it only reads them. Exporting is explicit and synchronous. Each
 * call to {@link render} returns a newly allocated buffer that the caller owns,
 * so results can be encoded, transferred, or discarded independently.
 */
export class ExportRenderer<
  Config extends ExportRendererConfig = ExportRendererConfig,
> {
  /** Sparse raster observed without allocation or mutation. */
  get raster(): Config["raster"] {
    return this.source["raster"];
  }
  /** Document composed when configured with a World. */
  get world(): Config["world"] {
    return this.source["world"];
  }

  private readonly source: RenderSourceSnapshot<Config>;

  /**
   * Creates an exporter bound to exactly one Raster or World.
   *
   * The exporter does not own the lifecycle of the supplied source (Raster or
   * World), including a World's layers and their Rasters.
   *
   * @param config - Independent storage or ordered document read by every pass.
   * @throws {ExporterTypeError} Both sources or neither are supplied.
   */
  constructor(config: Config) {
    this.source = resolveRenderSource(config, () =>
      ExporterTypeError.from(ExporterErrorDefinitions.INVALID_RENDER_SOURCE),
    );
  }

  /**
   * Extracts a dense RGBA8 bitmap from one world-pixel region of the configured source.
   *
   * The region uses half-open bounds `[x, x + width)` and `[y, y + height)`, and
   * one world pixel maps to exactly one exported pixel. Unallocated tiles and
   * untouched pixels read as transparent black. The supplied source (Raster or
   * World, including its layers' Rasters) is never modified. The returned buffer
   * is a fresh allocation owned by the caller.
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

    if (this.world !== undefined) {
      const intersection = intersectRenderRegion(region, this.world.bounds);
      if (intersection !== null) {
        for (const layer of getWorldCompositionLayers(this.world)) {
          copyIntersectingTiles(
            layer.raster,
            { x, y, width, height },
            pixels,
            layer.opacity,
            intersection,
            layer.blendMode,
          );
        }
      }
    } else if (this.raster !== undefined) {
      copyIntersectingTiles(this.raster, { x, y, width, height }, pixels);
    }

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
 * The output starts zeroed or contains previously composed layers. Absent tiles
 * leave existing output unchanged and are skipped without allocating storage.
 *
 * @param raster - Raster read without mutation.
 * @param region - Validated world-pixel region.
 * @param output - Row-major RGBA8 destination, potentially containing lower layers.
 * @param opacity - Layer opacity in [0, 1], or omission for byte-exact Raster copying.
 * @param intersection - Nonempty region clipped to document bounds; defaults to region.
 * @param blendMode - World layer blend mode, or omission for standalone Raster copying.
 */
function copyIntersectingTiles(
  raster: Raster,
  region: ExportRegion,
  output: Uint8ClampedArray,
  opacity?: number,
  intersection: ExportRegion = region,
  blendMode?: LayerBlendMode,
): void {
  const { tileSize } = raster;
  const minTileX = Math.floor(intersection.x / tileSize);
  const maxTileX = Math.floor(
    (intersection.x + intersection.width - 1) / tileSize,
  );
  const minTileY = Math.floor(intersection.y / tileSize);
  const maxTileY = Math.floor(
    (intersection.y + intersection.height - 1) / tileSize,
  );

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
        opacity,
        intersection,
        blendMode,
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
 * @param output - Row-major RGBA8 destination, potentially containing lower layers.
 * @param opacity - Layer opacity in [0, 1], or `undefined` for byte-exact copying.
 * @param intersection - Nonempty region clipped to document bounds.
 * @param blendMode - World layer blend mode, or `undefined` for standalone copying.
 */
function copyTileIntersection(
  tilePixels: Uint8ClampedArray,
  tileSize: number,
  tile: TileCoord,
  region: ExportRegion,
  output: Uint8ClampedArray,
  opacity: number | undefined,
  intersection: ExportRegion,
  blendMode: LayerBlendMode | undefined,
): void {
  const tileWorldX = tile.x * tileSize;
  const tileWorldY = tile.y * tileSize;
  const startX = Math.max(intersection.x, tileWorldX);
  const endX = Math.min(
    intersection.x + intersection.width,
    tileWorldX + tileSize,
  );
  const startY = Math.max(intersection.y, tileWorldY);
  const endY = Math.min(
    intersection.y + intersection.height,
    tileWorldY + tileSize,
  );

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

    if (opacity === undefined) {
      output.set(
        tilePixels.subarray(srcOffset, srcOffset + rowByteLength),
        dstOffset,
      );
    } else {
      for (
        let offset = 0;
        offset < rowByteLength;
        offset += RGBA_CHANNEL_COUNT
      ) {
        compositeRgbaSourceOverInPlace(
          tilePixels,
          srcOffset + offset,
          output,
          dstOffset + offset,
          opacity,
          blendMode,
        );
      }
    }
  }
}
