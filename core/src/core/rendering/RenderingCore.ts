import type { Raster } from "../raster/Raster.js";
import type { RasterLayer } from "../world/RasterLayer.js";
import type { WorldRect } from "../../interfaces/camera/WorldRect.js";
import type { RenderBudget } from "../../interfaces/renderer/RenderBudget.js";
import type { RenderContinuation } from "../../interfaces/renderer/RenderContinuation.js";
import type { RenderDiagnostics } from "../../interfaces/renderer/RenderDiagnostics.js";
import type { RenderLodStrategy } from "../../interfaces/renderer/RenderLodStrategy.js";
import type { RenderRegion } from "../../interfaces/renderer/RenderRegion.js";
import type { RenderRegionSet } from "../../interfaces/renderer/RenderRegionSet.js";
import type { RenderRequest } from "../../interfaces/renderer/RenderRequest.js";
import type { RenderRequestIdentity } from "../../interfaces/renderer/RenderRequestIdentity.js";
import type { RenderWorkState } from "../../interfaces/renderer/RenderWorkState.js";
import type { RenderingCoreConfig } from "../../interfaces/renderer/RenderingCoreConfig.js";
import type { TileCoord } from "../../interfaces/tile/TileCoord.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import {
  getAllocatedRasterTileViews,
  getRasterTileView,
} from "./bridge/RasterRenderBridge.js";
import { compositeRgbaSourceOverInPlace } from "./composition/CompositeRgbaSourceOverInPlace.js";
import { getWorldCompositionLayers } from "./composition/GetWorldCompositionLayers.js";
import { downsampleRgbaTile } from "./region/DownsampleRgbaTile.js";

const DEFAULT_RENDER_BUDGET: RenderBudget = {
  maxCandidateTiles: 128,
  maxGeneratedPixelBytes: 2 * 1024 * 1024,
  maxRenderDurationMs: 8,
};

const EMPTY_DIAGNOSTICS: RenderDiagnostics = {
  candidateTileCount: 0,
  renderedTileCount: 0,
  generatedPixelBytes: 0,
  renderDurationMs: 0,
  processedRegionCount: 0,
};

/** Opaque implementation token paired with mutable work through a WeakMap. */
class RenderContinuationToken implements RenderContinuation {
  readonly isRenderContinuation = true as const;

  constructor(readonly identity: RenderRequestIdentity) {}
}

/**
 * Resolves final platform-independent pixels from a render request.
 *
 * The core reads source tiles only while resolving a requested batch. When a
 * request exceeds its bounded workload, callers pull the continuation returned
 * with that batch. Starting a new request cancels any earlier continuation.
 */
export class RenderingCore {
  private readonly budget: RenderBudget;
  private readonly lodStrategy: RenderLodStrategy;
  private readonly continuationWork = new WeakMap<
    RenderContinuationToken,
    RenderWorkState
  >();
  private activeContinuation: RenderContinuationToken | null = null;
  private lastDiagnostics: RenderDiagnostics = EMPTY_DIAGNOSTICS;
  private nextRequestId = 1;

  /**
   * Creates a core with conservative configurable internal render limits.
   *
   * @param config - Optional budget and LOD-strategy overrides.
   * @throws {ReverieRangeError} A supplied budget cannot make forward progress.
   */
  constructor(config: RenderingCoreConfig = {}) {
    this.budget = RenderingCore.resolveBudget(config.budget);
    this.lodStrategy = config.lodStrategy ?? new ScaleRenderLodStrategy();
  }

  /**
   * Begins a fresh bounded render request, cancelling any prior continuation.
   *
   * A zero-area viewport requires no presentation and returns an empty set.
   * Each returned region owns a fresh RGBA8 buffer. If the result contains a
   * continuation, callers pull it through {@link continueRender} to complete
   * the same request without scheduling policy in this class.
   *
   * @param request - Source, runtime context, and complete requested viewport.
   * @returns One complete render result or the next partial batch with a handle.
   * @throws {ReverieTypeError} The viewport is missing or has a non-number component.
   * @throws {ReverieRangeError} A viewport or budget component is invalid.
   */
  render(request: RenderRequest): RenderRegionSet {
    this.cancelActiveContinuation();
    const viewport = RenderingCore.resolveViewport(request);
    const identity = this.resolveRequestIdentity(request, viewport);

    if (viewport.width === 0 || viewport.height === 0) {
      this.lastDiagnostics = EMPTY_DIAGNOSTICS;
      return { identity, regions: [] };
    }

    const work = this.createWork(request, viewport, identity);
    const continuation = new RenderContinuationToken(identity);
    this.activeContinuation = continuation;
    this.continuationWork.set(continuation, work);
    return this.resolveBatch(continuation, work);
  }

  /**
   * Pulls the next bounded batch for a still-current partial render.
   *
   * A continuation cancelled by a newer request returns an empty complete set.
   *
   * @param continuation - Handle returned from an incomplete prior result.
   * @returns The next partial or final region batch.
   */
  continueRender(continuation: RenderContinuation): RenderRegionSet {
    if (!(continuation instanceof RenderContinuationToken)) {
      return {
        identity: RenderingCore.createCancelledIdentity(),
        regions: [],
      };
    }
    const work = this.continuationWork.get(continuation);
    if (work === undefined || continuation !== this.activeContinuation) {
      return { identity: continuation.identity, regions: [] };
    }
    return this.resolveBatch(continuation, work);
  }

  /**
   * Returns a defensive snapshot of measurements for the most recent batch.
   *
   * @returns Candidate, output, allocation, and duration measurements.
   */
  getLastDiagnostics(): RenderDiagnostics {
    return { ...this.lastDiagnostics };
  }

  /** Creates lazy sparse traversal state without enumerating a viewport grid. */
  private createWork(
    request: RenderRequest,
    viewport: WorldRect,
    identity: RenderRequestIdentity,
  ): RenderWorkState {
    const source = request.source;
    const tileSize =
      "raster" in source ? source.raster.tileSize : source.world.tileSize;
    const outputTileSize = this.lodStrategy.resolveInitialOutputTileSize({
      tileSize,
      scale: request.context.scale,
    });
    this.assertValidOutputTileSize(outputTileSize, tileSize);

    if ("raster" in source) {
      return {
        identity,
        viewport,
        tileSize,
        outputTileSize,
        layers: null,
        raster: source.raster,
        candidateIterators: [getAllocatedRasterTileViews(source.raster)],
        iteratorIndex: 0,
        pendingCoords: [],
        isTraversalComplete: false,
        visitedWorldCoords: new Set<string>(),
      };
    }

    const layers = [...getWorldCompositionLayers(source.world)];
    return {
      identity,
      viewport,
      tileSize,
      outputTileSize,
      layers,
      raster: null,
      candidateIterators: layers.map((layer) =>
        getAllocatedRasterTileViews(layer.raster),
      ),
      iteratorIndex: 0,
      pendingCoords: [],
      isTraversalComplete: false,
      visitedWorldCoords: new Set<string>(),
    };
  }

  /** Resolves one batch in traversal, pixel-byte, then time-budget order. */
  private resolveBatch(
    continuation: RenderContinuationToken,
    work: RenderWorkState,
  ): RenderRegionSet {
    const startedAt = Date.now();
    const regions: RenderRegion[] = [];
    let candidateTileCount = 0;
    let generatedPixelBytes = 0;
    const coords = [...work.pendingCoords];
    work.pendingCoords.length = 0;

    while (
      !work.isTraversalComplete &&
      candidateTileCount < this.budget.maxCandidateTiles
    ) {
      if (
        candidateTileCount > 0 &&
        Date.now() - startedAt >= this.budget.maxRenderDurationMs
      ) {
        break;
      }

      const coord = this.resolveNextCandidate(work);
      if (coord === undefined) {
        work.isTraversalComplete = true;
        break;
      }
      candidateTileCount += 1;
      if (!RenderingCore.isTileVisible(coord, work.tileSize, work.viewport)) {
        continue;
      }
      if (work.layers !== null) {
        const key = `${coord.x}:${coord.y}`;
        if (work.visitedWorldCoords.has(key)) {
          continue;
        }
        work.visitedWorldCoords.add(key);
      }
      coords.push(coord);
    }

    for (let index = 0; index < coords.length; index += 1) {
      if (
        (candidateTileCount > 0 || regions.length > 0) &&
        Date.now() - startedAt >= this.budget.maxRenderDurationMs
      ) {
        work.pendingCoords.push(...coords.slice(index));
        break;
      }
      const coord = coords[index];
      if (coord === undefined) {
        continue;
      }
      const pixelByteLength = work.outputTileSize ** 2 * 4;
      const exceedsPixelBudget =
        generatedPixelBytes + pixelByteLength >
        this.budget.maxGeneratedPixelBytes;
      if (exceedsPixelBudget && regions.length > 0) {
        work.pendingCoords.push(...coords.slice(index));
        break;
      }
      const pixels = this.resolvePixels(work, coord);
      if (pixels === undefined) {
        continue;
      }
      regions.push({
        bounds: RenderingCore.tileBounds(coord, work.tileSize),
        pixels,
      });
      generatedPixelBytes += pixels.byteLength;
    }

    const renderDurationMs = Math.max(0, Date.now() - startedAt);
    this.lastDiagnostics = {
      candidateTileCount,
      renderedTileCount: regions.length,
      generatedPixelBytes,
      renderDurationMs,
      processedRegionCount: regions.length,
    };

    if (work.isTraversalComplete && work.pendingCoords.length === 0) {
      this.continuationWork.delete(continuation);
      if (this.activeContinuation === continuation) {
        this.activeContinuation = null;
      }
      return { identity: work.identity, regions };
    }
    return { identity: work.identity, regions, continuation };
  }

  /** Uses caller metadata when present, otherwise creates a local safe default. */
  private resolveRequestIdentity(
    request: RenderRequest,
    viewport: WorldRect,
  ): RenderRequestIdentity {
    if (request.identity !== undefined) {
      return request.identity;
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return {
      requestId,
      viewportKey: `${viewport.x}:${viewport.y}:${viewport.width}:${viewport.height}`,
      sourceRevision: "unversioned",
    };
  }

  /** Identifies an invalid foreign continuation without accepting its output. */
  private static createCancelledIdentity(): RenderRequestIdentity {
    return {
      requestId: 0,
      viewportKey: "cancelled",
      sourceRevision: "cancelled",
    };
  }

  /** Advances one sparse allocation iterator without probing a viewport grid. */
  private resolveNextCandidate(work: RenderWorkState): TileCoord | undefined {
    while (work.iteratorIndex < work.candidateIterators.length) {
      const iterator = work.candidateIterators[work.iteratorIndex];
      if (iterator === undefined) {
        return undefined;
      }
      const next = iterator.next();
      if (next.done) {
        work.iteratorIndex += 1;
        continue;
      }
      return next.value.coord;
    }
    return undefined;
  }

  /** Resolves one allocated candidate into independent final pixels. */
  private resolvePixels(
    work: RenderWorkState,
    coord: TileCoord,
  ): Uint8Array | undefined {
    if (work.raster !== null) {
      const tile = getRasterTileView(work.raster, coord);
      return tile === undefined
        ? undefined
        : RenderingCore.downsamplePixels(
            tile.pixels,
            work.tileSize,
            work.outputTileSize,
          );
    }
    return RenderingCore.composeWorldTile(
      work.layers ?? [],
      coord,
      work.tileSize,
      work.outputTileSize,
    );
  }

  /** Produces final straight-alpha RGBA8 pixels for one World tile. */
  private static composeWorldTile(
    layers: readonly RasterLayer[],
    coord: TileCoord,
    tileSize: number,
    outputTileSize: number,
  ): Uint8Array | undefined {
    let composedPixels: Uint8ClampedArray | undefined;
    for (const layer of layers) {
      const tile = getRasterTileView(layer.raster, coord);
      if (tile === undefined) {
        continue;
      }
      composedPixels ??= new Uint8ClampedArray(tileSize * tileSize * 4);
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
    return composedPixels === undefined
      ? undefined
      : RenderingCore.downsamplePixels(
          composedPixels,
          tileSize,
          outputTileSize,
        );
  }

  /** Converts source pixels to the exact output resolution requested for this pass. */
  private static downsamplePixels(
    pixels: Uint8ClampedArray,
    tileSize: number,
    outputTileSize: number,
  ): Uint8Array {
    return new Uint8Array(downsampleRgbaTile(pixels, tileSize, outputTileSize));
  }

  /** Rejects a strategy result that could create invalid or unbounded output. */
  private assertValidOutputTileSize(
    outputTileSize: number,
    tileSize: number,
  ): void {
    if (
      !Number.isSafeInteger(outputTileSize) ||
      outputTileSize <= 0 ||
      outputTileSize > tileSize
    ) {
      throw ReverieRangeError.from(
        ErrorDefinitions.RENDERING.INVALID_LOD_STRATEGY_RESULT,
        { outputTileSize, tileSize },
      );
    }
  }

  /** Cancels retained state for the previous request without touching document data. */
  private cancelActiveContinuation(): void {
    if (this.activeContinuation !== null) {
      this.continuationWork.delete(this.activeContinuation);
      this.activeContinuation = null;
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

  /** Tests a sparse Tile directly against a continuous viewport. */
  private static isTileVisible(
    coord: TileCoord,
    tileSize: number,
    viewport: WorldRect,
  ): boolean {
    const left = coord.x * tileSize;
    const top = coord.y * tileSize;
    return (
      left < viewport.x + viewport.width &&
      left + tileSize > viewport.x &&
      top < viewport.y + viewport.height &&
      top + tileSize > viewport.y
    );
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

  /** Validates and resolves one internal budget configuration. */
  private static resolveBudget(
    overrides: Partial<RenderBudget> | undefined,
  ): RenderBudget {
    const budget = { ...DEFAULT_RENDER_BUDGET, ...overrides };
    const isPositiveSafeInteger = (value: number): boolean =>
      Number.isSafeInteger(value) && value > 0;
    if (!isPositiveSafeInteger(budget.maxCandidateTiles)) {
      throw RenderingCore.createInvalidBudgetError("maxCandidateTiles");
    }
    if (
      !isPositiveSafeInteger(budget.maxGeneratedPixelBytes) ||
      budget.maxGeneratedPixelBytes < 4
    ) {
      throw RenderingCore.createInvalidBudgetError("maxGeneratedPixelBytes");
    }
    if (
      !Number.isFinite(budget.maxRenderDurationMs) ||
      budget.maxRenderDurationMs <= 0
    ) {
      throw RenderingCore.createInvalidBudgetError("maxRenderDurationMs");
    }
    return budget;
  }

  /** Creates a stable error for a budget component that cannot make progress. */
  private static createInvalidBudgetError(
    component: string,
  ): ReverieRangeError {
    return ReverieRangeError.from(
      ErrorDefinitions.RENDERING.INVALID_RENDER_BUDGET,
      {
        component,
      },
    );
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

/** Preserves the existing scale-derived power-of-two output resolution behavior. */
class ScaleRenderLodStrategy implements RenderLodStrategy {
  resolveInitialOutputTileSize({
    tileSize,
    scale,
  }: {
    readonly tileSize: number;
    readonly scale: number | undefined;
  }): number {
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
}
