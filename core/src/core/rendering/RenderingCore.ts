import type { RasterLayer } from "../world/RasterLayer.js";
import type { Raster } from "../raster/Raster.js";
import type { World } from "../world/World.js";
import type { RenderRegion } from "../../interfaces/renderer/RenderRegion.js";
import type { RenderRegionSet } from "../../interfaces/renderer/RenderRegionSet.js";
import type { RenderRequest } from "../../interfaces/renderer/RenderRequest.js";
import type { WorldRect } from "../../interfaces/camera/WorldRect.js";
import type { TileCoord } from "../../interfaces/tile/TileCoord.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { getRasterTileView } from "./bridge/RasterRenderBridge.js";
import { compositeRgbaSourceOverInPlace } from "./composition/CompositeRgbaSourceOverInPlace.js";
import { getWorldCompositionLayers } from "./composition/GetWorldCompositionLayers.js";
import { downsampleRgbaTile } from "./region/DownsampleRgbaTile.js";

/**
 * Resolves final platform-independent pixels from a render request.
 *
 * The core reads source tiles only for the duration of a render call. It does
 * not retain document snapshots or Raster pixel buffers between calls.
 */
export class RenderingCore {
  /**
   * Resolves all nonempty tile regions required to render the requested viewport.
   *
   * A zero-area viewport requires no presentation and returns an empty set.
   * Each region contains a fresh RGBA8 buffer, so no backend can access or
   * mutate source Raster storage. Dirty-region tracking is intentionally
   * deferred; this method resolves every visible source tile.
   *
   * @param request - Source, runtime context, and complete requested viewport.
   * @returns Ordered final-pixel regions for the backend to present.
   * @throws {ReverieTypeError} The viewport is missing or has a non-number component.
   * @throws {ReverieRangeError} A viewport component is non-finite, or an extent is negative.
   */
  render(request: RenderRequest): RenderRegionSet {
    const viewport = RenderingCore.resolveViewport(request);

    if (viewport.width === 0 || viewport.height === 0) {
      return { regions: [] };
    }

    const source = request.source;
    const outputTileSize = RenderingCore.resolveOutputTileSize(
      "raster" in source ? source.raster.tileSize : source.world.tileSize,
      request.context.scale,
    );
    if ("raster" in source) {
      return {
        regions: this.resolveRasterRegions(
          source.raster,
          viewport,
          outputTileSize,
        ),
      };
    }

    return {
      regions: this.resolveWorldRegions(source.world, viewport, outputTileSize),
    };
  }

  /** Extracts final source pixels for every allocated Raster tile in view. */
  private resolveRasterRegions(
    raster: Raster,
    viewport: WorldRect,
    outputTileSize: number,
  ): RenderRegion[] {
    const regions: RenderRegion[] = [];
    for (const coord of RenderingCore.visibleTileCoords(
      raster.tileSize,
      viewport,
    )) {
      const tile = getRasterTileView(raster, coord);
      if (tile === undefined) {
        continue;
      }
      regions.push({
        bounds: RenderingCore.tileBounds(coord, raster.tileSize),
        pixels: RenderingCore.downsamplePixels(
          tile.pixels,
          raster.tileSize,
          outputTileSize,
        ),
      });
    }
    return regions;
  }

  /** Composites every visible World layer into each allocated tile in view. */
  private resolveWorldRegions(
    world: World,
    viewport: WorldRect,
    outputTileSize: number,
  ): RenderRegion[] {
    const layers = [...getWorldCompositionLayers(world)];
    if (layers.length === 0) {
      return [];
    }

    const regions: RenderRegion[] = [];
    for (const coord of RenderingCore.visibleTileCoords(
      world.tileSize,
      viewport,
    )) {
      const pixels = RenderingCore.composeWorldTile(
        layers,
        coord,
        world.tileSize,
        outputTileSize,
      );
      if (pixels === undefined) {
        continue;
      }
      regions.push({
        bounds: RenderingCore.tileBounds(coord, world.tileSize),
        pixels,
      });
    }
    return regions;
  }

  /** Produces the final straight-alpha RGBA8 pixels for one World tile. */
  private static composeWorldTile(
    layers: readonly RasterLayer[],
    coord: TileCoord,
    tileSize: number,
    outputTileSize: number,
  ): Uint8Array | undefined {
    const composedPixels = new Uint8ClampedArray(tileSize * tileSize * 4);
    let hasSource = false;
    for (const layer of layers) {
      const tile = getRasterTileView(layer.raster, coord);
      if (tile === undefined) {
        continue;
      }
      hasSource = true;
      for (let offset = 0; offset < tile.pixels.length; offset += 4) {
        compositeRgbaSourceOverInPlace(
          tile.pixels,
          offset,
          composedPixels,
          offset,
          layer.opacity,
          layer.blendMode,
        );
      }
    }
    return hasSource
      ? RenderingCore.downsamplePixels(composedPixels, tileSize, outputTileSize)
      : undefined;
  }

  /** Converts a source tile to the exact output resolution requested for this pass. */
  private static downsamplePixels(
    pixels: Uint8ClampedArray,
    tileSize: number,
    outputTileSize: number,
  ): Uint8Array {
    return new Uint8Array(downsampleRgbaTile(pixels, tileSize, outputTileSize));
  }

  /** Chooses the same power-of-two LOD resolution previously used by Canvas. */
  private static resolveOutputTileSize(
    tileSize: number,
    scale: number | undefined,
  ): number {
    if (
      scale === undefined ||
      !Number.isFinite(scale) ||
      scale >= 1 ||
      scale <= 0
    ) {
      return tileSize;
    }
    const maximumLevel = Math.ceil(Math.log2(tileSize));
    const level = Math.max(
      0,
      Math.min(maximumLevel, Math.round(Math.log2(1 / scale))),
    );
    return Math.max(1, Math.ceil(tileSize / 2 ** level));
  }

  /** Iterates safely-addressable Tiles that overlap a continuous viewport. */
  private static *visibleTileCoords(
    tileSize: number,
    viewport: WorldRect,
  ): IterableIterator<TileCoord> {
    const right = viewport.x + viewport.width;
    const bottom = viewport.y + viewport.height;
    const minX = Math.floor(viewport.x / tileSize);
    const minY = Math.floor(viewport.y / tileSize);
    const maxX = Math.ceil(right / tileSize) - 1;
    const maxY = Math.ceil(bottom / tileSize) - 1;
    if (![minX, minY, maxX, maxY].every(Number.isSafeInteger)) {
      return;
    }
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        yield { x, y };
      }
    }
  }

  /** Maps one tile-grid coordinate to its full half-open world bounds. */
  private static tileBounds(coord: TileCoord, tileSize: number): WorldRect {
    return {
      x: coord.x * tileSize,
      y: coord.y * tileSize,
      width: tileSize,
      height: tileSize,
    };
  }

  /** Reads and validates a complete continuous viewport from an external request. */
  private static resolveViewport(request: unknown): WorldRect {
    if (typeof request !== "object" || request === null) {
      throw ReverieTypeError.from(ErrorDefinitions.RENDERING.INVALID_REQUEST);
    }

    if (!("viewport" in request)) {
      throw ReverieTypeError.from(ErrorDefinitions.RENDERING.INVALID_REQUEST);
    }

    const { viewport } = request;
    if (typeof viewport !== "object" || viewport === null) {
      throw ReverieTypeError.from(ErrorDefinitions.RENDERING.INVALID_REQUEST);
    }

    if (
      !("x" in viewport) ||
      !("y" in viewport) ||
      !("width" in viewport) ||
      !("height" in viewport)
    ) {
      throw ReverieTypeError.from(ErrorDefinitions.RENDERING.INVALID_REQUEST);
    }

    const { x, y, width, height } = viewport;
    RenderingCore.assertFiniteComponent(x, "x");
    RenderingCore.assertFiniteComponent(y, "y");
    RenderingCore.assertFiniteComponent(width, "width");
    RenderingCore.assertFiniteComponent(height, "height");

    if (width < 0 || height < 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.RENDERING.INVALID_VIEWPORT_EXTENT,
      );
    }

    return { x, y, width, height };
  }

  /** Validates one finite numeric viewport component. */
  private static assertFiniteComponent(
    value: unknown,
    component: string,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(
        ErrorDefinitions.RENDERING.INVALID_VIEWPORT_COMPONENT_TYPE,
        { component, received: typeof value },
      );
    }
    if (!Number.isFinite(value)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.RENDERING.INVALID_VIEWPORT_COMPONENT_VALUE,
        { component, received: value },
      );
    }
  }
}
