import type { Raster } from "../raster/Raster.js";
import type { RasterLayer } from "../world/RasterLayer.js";
import type { World } from "../world/World.js";
import type { WorldRect } from "../../interfaces/camera/WorldRect.js";
import type { RenderBudget } from "../../interfaces/renderer/RenderBudget.js";
import type { RenderContext } from "../../interfaces/renderer/RenderContext.js";
import type { RenderContinuation } from "../../interfaces/renderer/RenderContinuation.js";
import type { RenderDiagnostics } from "../../interfaces/renderer/RenderDiagnostics.js";
import type { RenderingCoreDiagnosticsSnapshot } from "../../interfaces/renderer/RenderingCoreDiagnosticsSnapshot.js";
import type { RenderLodStrategy } from "../../interfaces/renderer/RenderLodStrategy.js";
import type { RenderRegion } from "../../interfaces/renderer/RenderRegion.js";
import type { RenderRegionSet } from "../../interfaces/renderer/RenderRegionSet.js";
import type { RenderResultClass } from "../../interfaces/renderer/RenderResultClass.js";
import type { RenderRequest } from "../../interfaces/renderer/RenderRequest.js";
import type { RenderRequestIdentity } from "../../interfaces/renderer/RenderRequestIdentity.js";
import type { RenderWorkState } from "../../interfaces/renderer/RenderWorkState.js";
import type { RasterTileView } from "../../interfaces/renderer/RasterTileView.js";
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
import { composeWorldPreviewTile } from "./composition/ComposeWorldPreviewTile.js";
import { getWorldCompositionLayers } from "./composition/GetWorldCompositionLayers.js";
import RenderResultCache from "./cache/RenderResultCache.js";
import { downsampleRgbaTile } from "./region/DownsampleRgbaTile.js";
import TileRenderSummaryCache from "./summary/TileRenderSummaryCache.js";
import RollingTiming from "./diagnostics/RollingTiming.js";

const DEFAULT_RENDER_BUDGET: RenderBudget = {
  maxCandidateTiles: 128,
  maxGeneratedPixelBytes: 2 * 1024 * 1024,
  maxRenderDurationMs: 8,
};
const DEFAULT_RESULT_CACHE_BYTE_BUDGET = 32 * 1024 * 1024;

const EMPTY_DIAGNOSTICS: RenderDiagnostics = {
  candidateTileCount: 0,
  renderedTileCount: 0,
  generatedPixelBytes: 0,
  outputPixelBytes: 0,
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
  private readonly resultCache: RenderResultCache;
  private sourceIds = new WeakMap<object, number>();
  private nextSourceId = 1;
  private readonly continuationWork = new WeakMap<
    RenderContinuationToken,
    RenderWorkState
  >();
  private activeContinuation: RenderContinuationToken | null = null;
  private lastDiagnostics: RenderDiagnostics = EMPTY_DIAGNOSTICS;
  private nextRequestId = 1;
  private readonly tileRenderSummaries = new TileRenderSummaryCache();
  private timingsEnabled: boolean;
  private readonly coreTiming = new RollingTiming();
  private readonly rasterTiming = new RollingTiming();
  private readonly compositionTiming = new RollingTiming();
  private readonly lodTiming = new RollingTiming();
  private requestCount = 0;
  private completedRequestCount = 0;
  private cancelledRequestCount = 0;
  private continuationCount = 0;
  private batchCount = 0;
  private visibleTileCount = 0;
  private renderEmptyTileCount = 0;
  private outputTileSize: number | undefined;
  private sourceTileSize: number | undefined;
  private rasterDurationMs = 0;
  private compositionDurationMs = 0;
  private lodDurationMs = 0;
  private worldCanonicalGeneratedCount = 0;
  private worldApproximateGeneratedCount = 0;
  private worldCanonicalCacheHits = 0;
  private worldApproximateCacheHits = 0;
  private worldCanonicalCompositionPixels = 0;
  private worldApproximateCompositionPixels = 0;
  private worldCanonicalGenerationDurationMs = 0;
  private worldApproximateGenerationDurationMs = 0;

  /**
   * Creates a core with conservative configurable internal render limits.
   *
   * @param config - Optional budget and LOD-strategy overrides.
   * @throws {ReverieRangeError} A supplied budget cannot make forward progress.
   */
  constructor(config: RenderingCoreConfig = {}) {
    this.budget = RenderingCore.resolveBudget(config.budget);
    this.lodStrategy = config.lodStrategy ?? new ScaleRenderLodStrategy();
    const resultCacheByteBudget =
      config.resultCacheByteBudget ?? DEFAULT_RESULT_CACHE_BYTE_BUDGET;
    if (
      !Number.isSafeInteger(resultCacheByteBudget) ||
      resultCacheByteBudget < 0
    ) {
      throw RenderingCore.createInvalidBudgetError("resultCacheByteBudget");
    }
    this.resultCache = new RenderResultCache(resultCacheByteBudget);
    this.timingsEnabled = config.diagnostics?.timings === true;
  }

  /**
   * Enables or disables stage timings without changing render counters or work.
   * Switching modes starts a fresh rolling timing window.
   * @param enabled - Whether later render batches collect stage durations.
   * @throws {ReverieTypeError} The value is not a boolean at runtime.
   */
  setTimingDiagnosticsEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") {
      throw ReverieTypeError.from(
        ErrorDefinitions.RENDERING.INVALID_DIAGNOSTICS_TIMINGS,
      );
    }
    if (this.timingsEnabled === enabled) {
      return;
    }
    this.timingsEnabled = enabled;
    this.coreTiming.clear();
    this.rasterTiming.clear();
    this.compositionTiming.clear();
    this.lodTiming.clear();
  }

  /**
   * Resolves the actual square pixel size requested for each output Tile.
   * Equal sizes represent the same generation requirement even when raw camera
   * scales or quality labels differ.
   * @param tileSize - Source Tile edge length in pixels.
   * @param context - Scale and quality used for this render request.
   * @returns Effective output Tile edge length in pixels.
   * @throws {ReverieRangeError} The LOD strategy returns an invalid size.
   */
  resolveOutputTileSize(tileSize: number, context: RenderContext): number {
    if (!Number.isSafeInteger(tileSize) || tileSize <= 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.RENDERING.INVALID_LOD_STRATEGY_RESULT,
        { tileSize, outputTileSize: tileSize },
      );
    }
    if (
      context.quality !== undefined &&
      context.quality !== "full" &&
      context.quality !== "interactive"
    ) {
      throw ReverieTypeError.from(
        ErrorDefinitions.RENDERING.INVALID_RENDER_QUALITY,
      );
    }
    const requestedScale = context.scale;
    const outputTileSize = this.lodStrategy.resolveInitialOutputTileSize({
      tileSize,
      scale:
        context.quality === "interactive" && requestedScale !== undefined
          ? requestedScale / 2
          : requestedScale,
    });
    this.assertValidOutputTileSize(outputTileSize, tileSize);
    return outputTileSize;
  }

  /**
   * Begins a fresh bounded render request, cancelling any prior continuation.
   *
   * A zero-area viewport requires no presentation and returns an empty set.
   * A returned region may reuse an immutable RGBA8 buffer from this Core's
   * result cache. If the result contains a
   * continuation, callers pull it through {@link continueRender} to complete
   * the same request without scheduling policy in this class.
   *
   * @param request - Source, runtime context, and complete requested viewport.
   * @returns One complete render result or the next partial batch with a handle.
   * @throws {ReverieTypeError} The viewport is missing, has a non-number component, or quality is unsupported.
   * @throws {ReverieRangeError} A viewport or budget component is invalid.
   */
  render(request: RenderRequest): RenderRegionSet {
    this.cancelActiveContinuation();
    const viewport = RenderingCore.resolveViewport(request);
    if (
      request.context.quality !== undefined &&
      request.context.quality !== "full" &&
      request.context.quality !== "interactive"
    ) {
      throw ReverieTypeError.from(
        ErrorDefinitions.RENDERING.INVALID_RENDER_QUALITY,
      );
    }
    const identity = this.resolveRequestIdentity(request, viewport);
    this.requestCount += 1;

    if (viewport.width === 0 || viewport.height === 0) {
      this.lastDiagnostics = EMPTY_DIAGNOSTICS;
      this.visibleTileCount = 0;
      this.renderEmptyTileCount = 0;
      this.outputTileSize = undefined;
      this.sourceTileSize = undefined;
      this.completedRequestCount += 1;
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
    this.continuationCount += 1;
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

  /** Cancels an unfinished request when its owner discards the continuation. */
  cancelPendingRender(): void {
    this.cancelActiveContinuation();
  }

  /** Releases retained result pixels and pending work owned by this Core. */
  dispose(): void {
    this.cancelActiveContinuation();
    this.resultCache.clear();
    this.sourceIds = new WeakMap<object, number>();
    this.nextSourceId = 1;
  }

  /** Returns detached counters and optional rolling timings for this core. */
  getDiagnosticsSnapshot(): RenderingCoreDiagnosticsSnapshot {
    const coreDurationMs = this.coreTiming.getSnapshot();
    const rasterDurationMs = this.rasterTiming.getSnapshot();
    const compositionDurationMs = this.compositionTiming.getSnapshot();
    const lodDurationMs = this.lodTiming.getSnapshot();
    const snapshot: RenderingCoreDiagnosticsSnapshot = {
      resultCache: this.resultCache.getSnapshot(),
      ...(coreDurationMs !== undefined &&
      rasterDurationMs !== undefined &&
      compositionDurationMs !== undefined &&
      lodDurationMs !== undefined
        ? {
            rendering: {
              coreDurationMs,
              rasterDurationMs,
              compositionDurationMs,
              lodDurationMs,
            },
          }
        : {}),
      tiles: {
        candidateCount: this.lastDiagnostics.candidateTileCount,
        visibleCount: this.visibleTileCount,
        renderedCount: this.lastDiagnostics.renderedTileCount,
        renderEmptyCount: this.renderEmptyTileCount,
        generatedPixelBytes: this.lastDiagnostics.generatedPixelBytes,
        outputPixelBytes: this.lastDiagnostics.outputPixelBytes,
      },
      regions: { generatedCount: this.lastDiagnostics.processedRegionCount },
      world: {
        canonicalGeneratedCount: this.worldCanonicalGeneratedCount,
        approximateGeneratedCount: this.worldApproximateGeneratedCount,
        canonicalCacheHits: this.worldCanonicalCacheHits,
        approximateCacheHits: this.worldApproximateCacheHits,
        canonicalCompositionPixels: this.worldCanonicalCompositionPixels,
        approximateCompositionPixels: this.worldApproximateCompositionPixels,
        canonicalGenerationDurationMs: this.worldCanonicalGenerationDurationMs,
        approximateGenerationDurationMs:
          this.worldApproximateGenerationDurationMs,
      },
      progressive: {
        requestCount: this.requestCount,
        completedRequestCount: this.completedRequestCount,
        cancelledRequestCount: this.cancelledRequestCount,
        continuationCount: this.continuationCount,
        batchCount: this.batchCount,
        hasPendingRequest: this.activeContinuation !== null,
      },
      ...(this.outputTileSize !== undefined && this.sourceTileSize !== undefined
        ? {
            quality: {
              outputTileSize: this.outputTileSize,
              effectiveRenderScale: this.outputTileSize / this.sourceTileSize,
            },
          }
        : {}),
    };
    return Object.freeze({
      ...snapshot,
      ...(snapshot.rendering === undefined
        ? {}
        : { rendering: Object.freeze(snapshot.rendering) }),
      tiles: Object.freeze(snapshot.tiles),
      resultCache: Object.freeze({
        ...snapshot.resultCache,
        hitsByOutputTileSize: Object.freeze(
          snapshot.resultCache.hitsByOutputTileSize,
        ),
      }),
      regions: Object.freeze(snapshot.regions),
      world: Object.freeze(snapshot.world),
      progressive: Object.freeze(snapshot.progressive),
      ...(snapshot.quality === undefined
        ? {}
        : { quality: Object.freeze(snapshot.quality) }),
    });
  }

  /** Creates lazy sparse traversal state without enumerating a viewport grid. */
  private createWork(
    request: RenderRequest,
    viewport: WorldRect,
    identity: RenderRequestIdentity,
  ): RenderWorkState {
    const source = request.source;
    const sourceObject = "raster" in source ? source.raster : source.world;
    let sourceId = this.sourceIds.get(sourceObject);
    if (sourceId === undefined) {
      sourceId = this.nextSourceId++;
      this.sourceIds.set(sourceObject, sourceId);
    }
    const tileSize =
      "raster" in source ? source.raster.tileSize : source.world.tileSize;
    const outputTileSize = this.resolveOutputTileSize(
      tileSize,
      request.context,
    );
    const resultClass: RenderResultClass =
      "world" in source &&
      request.context.quality === "interactive" &&
      outputTileSize < tileSize
        ? "approximate"
        : "canonical";
    const interactiveTiles = RenderingCore.resolveInteractiveTiles(
      request.interactiveTiles,
      tileSize,
      viewport,
    );
    const interactiveState = {
      interactiveTiles,
      interactiveIndex: 0,
      interactiveKeys: new Set(interactiveTiles.map(({ x, y }) => `${x}:${y}`)),
    };
    const skipKeys = new Set(
      RenderingCore.resolveInteractiveTiles(
        request.skipTiles,
        tileSize,
        viewport,
      ).map(({ x, y }) => `${x}:${y}`),
    );
    const excludedViewport =
      request.excludeViewport === undefined
        ? null
        : RenderingCore.resolveViewport({ viewport: request.excludeViewport });

    if ("raster" in source) {
      return {
        identity,
        viewport,
        excludedViewport,
        tileSize,
        outputTileSize,
        resultClass,
        layers: null,
        raster: source.raster,
        world: null,
        sourceId,
        candidateIterators: [getAllocatedRasterTileViews(source.raster)],
        iteratorIndex: 0,
        pendingCoords: [],
        isTraversalComplete: false,
        visitedWorldCoords: new Set<string>(),
        ...interactiveState,
        skipKeys,
      };
    }

    const layers = [...getWorldCompositionLayers(source.world)];
    return {
      identity,
      viewport,
      excludedViewport,
      tileSize,
      outputTileSize,
      resultClass,
      layers,
      raster: null,
      world: source.world,
      sourceId,
      candidateIterators: layers.map((layer) =>
        getAllocatedRasterTileViews(layer.raster),
      ),
      iteratorIndex: 0,
      pendingCoords: [],
      isTraversalComplete: false,
      visitedWorldCoords: new Set<string>(),
      ...interactiveState,
      skipKeys,
    };
  }

  /** Resolves one batch in traversal, pixel-byte, then time-budget order. */
  private resolveBatch(
    continuation: RenderContinuationToken,
    work: RenderWorkState,
  ): RenderRegionSet {
    this.outputTileSize = work.outputTileSize;
    this.sourceTileSize = work.tileSize;
    const startedAt = Date.now();
    const timingStartedAt = this.timingsEnabled ? performance.now() : 0;
    this.rasterDurationMs = 0;
    this.compositionDurationMs = 0;
    this.lodDurationMs = 0;
    const regions: RenderRegion[] = [];
    let candidateTileCount = 0;
    let inspectedTileCount = 0;
    let visibleTileCount = 0;
    let renderEmptyTileCount = 0;
    let outputPixelBytes = 0;
    let generatedPixelBytes = 0;
    const pixelByteLength = work.outputTileSize ** 2 * 4;
    while (work.interactiveIndex < work.interactiveTiles.length) {
      if (
        regions.length > 0 &&
        (outputPixelBytes + pixelByteLength >
          this.budget.maxGeneratedPixelBytes ||
          Date.now() - startedAt >= this.budget.maxRenderDurationMs)
      ) {
        break;
      }
      const coord = work.interactiveTiles[work.interactiveIndex];
      work.interactiveIndex += 1;
      if (coord === undefined) {
        continue;
      }
      const region = this.resolveRegion(work, coord);
      visibleTileCount += 1;
      if (region !== undefined) {
        regions.push(region.region);
        outputPixelBytes += region.region.pixels.byteLength;
        if (!region.isCached) {
          generatedPixelBytes += region.region.pixels.byteLength;
        }
      } else {
        renderEmptyTileCount += 1;
      }
    }
    const coords = [...work.pendingCoords];
    work.pendingCoords.length = 0;

    while (
      work.interactiveIndex === work.interactiveTiles.length &&
      !work.isTraversalComplete &&
      candidateTileCount < this.budget.maxCandidateTiles
    ) {
      if (
        inspectedTileCount > 0 &&
        inspectedTileCount % this.budget.maxCandidateTiles === 0 &&
        Date.now() - startedAt >= this.budget.maxRenderDurationMs
      ) {
        break;
      }

      const coord = this.resolveNextCandidate(work);
      if (coord === undefined) {
        work.isTraversalComplete = true;
        break;
      }
      inspectedTileCount += 1;
      if (work.interactiveKeys.has(`${coord.x}:${coord.y}`)) {
        continue;
      }
      if (
        work.skipKeys.has(`${coord.x}:${coord.y}`) ||
        (work.excludedViewport !== null &&
          RenderingCore.isTileVisible(
            coord,
            work.tileSize,
            work.excludedViewport,
          ))
      ) {
        continue;
      }
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
      candidateTileCount += 1;
      visibleTileCount += 1;
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
      const exceedsPixelBudget =
        outputPixelBytes + pixelByteLength > this.budget.maxGeneratedPixelBytes;
      if (exceedsPixelBudget && regions.length > 0) {
        work.pendingCoords.push(...coords.slice(index));
        break;
      }
      const region = this.resolveRegion(work, coord);
      if (region === undefined) {
        renderEmptyTileCount += 1;
        continue;
      }
      regions.push(region.region);
      outputPixelBytes += region.region.pixels.byteLength;
      if (!region.isCached) {
        generatedPixelBytes += region.region.pixels.byteLength;
      }
    }

    const renderDurationMs = Math.max(0, Date.now() - startedAt);
    this.lastDiagnostics = {
      candidateTileCount,
      renderedTileCount: regions.length,
      generatedPixelBytes,
      outputPixelBytes,
      renderDurationMs,
      processedRegionCount: regions.length,
    };
    this.visibleTileCount = visibleTileCount;
    this.renderEmptyTileCount = renderEmptyTileCount;
    this.batchCount += 1;
    if (this.timingsEnabled) {
      this.coreTiming.record(Math.max(0, performance.now() - timingStartedAt));
      this.rasterTiming.record(this.rasterDurationMs);
      this.compositionTiming.record(this.compositionDurationMs);
      this.lodTiming.record(this.lodDurationMs);
    }

    if (
      work.interactiveIndex === work.interactiveTiles.length &&
      work.isTraversalComplete &&
      work.pendingCoords.length === 0
    ) {
      this.continuationWork.delete(continuation);
      if (this.activeContinuation === continuation) {
        this.activeContinuation = null;
      }
      this.completedRequestCount += 1;
      return { identity: work.identity, regions };
    }
    return { identity: work.identity, regions, continuation };
  }

  /** Validates, deduplicates, and clips explicit drawing hints to the viewport. */
  private static resolveInteractiveTiles(
    tiles: readonly TileCoord[] | undefined,
    tileSize: number,
    viewport: WorldRect,
  ): readonly TileCoord[] {
    if (tiles === undefined) {
      return [];
    }
    if (!Array.isArray(tiles)) {
      throw ReverieTypeError.from(ErrorDefinitions.RENDERING.INVALID_REQUEST);
    }
    const unique = new Map<string, TileCoord>();
    for (const coord of tiles) {
      if (
        typeof coord !== "object" ||
        coord === null ||
        !Number.isSafeInteger(coord.x) ||
        !Number.isSafeInteger(coord.y)
      ) {
        throw ReverieRangeError.from(
          ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
          coord,
        );
      }
      if (RenderingCore.isTileVisible(coord, tileSize, viewport)) {
        unique.set(`${coord.x}:${coord.y}`, { x: coord.x, y: coord.y });
      }
    }
    return [...unique.values()];
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

  /** Selects an emitted candidate before resolving viewport-independent pixels. */
  private resolveRegion(
    work: RenderWorkState,
    coord: TileCoord,
  ): { readonly region: RenderRegion; readonly isCached: boolean } | undefined {
    const bounds = RenderingCore.tileBounds(coord, work.tileSize);
    const key = `${work.sourceId}:${coord.x}:${coord.y}:${work.tileSize}:${work.outputTileSize}`;
    if (work.raster !== null) {
      const startedAt = this.timingsEnabled ? performance.now() : 0;
      const tile = getRasterTileView(work.raster, coord);
      if (
        tile === undefined ||
        !this.hasVisibleAlpha(tile, coord, work.tileSize, work.viewport)
      ) {
        if (this.timingsEnabled) {
          this.rasterDurationMs += performance.now() - startedAt;
        }
        return undefined;
      }
      const signature = `${tile.tileId}:${tile.revision}`;
      const cached = this.resultCache.get(key, signature, work.outputTileSize);
      if (cached !== undefined) {
        if (this.timingsEnabled) {
          this.rasterDurationMs += performance.now() - startedAt;
        }
        return { region: cached, isCached: true };
      }
      const pixels = this.downsamplePixels(
        tile.pixels,
        work.tileSize,
        work.outputTileSize,
      );
      if (this.timingsEnabled) {
        this.rasterDurationMs += performance.now() - startedAt;
      }
      const region = { bounds, pixels };
      this.resultCache.set(key, signature, region);
      return { region, isCached: false };
    }
    const world = work.world;
    if (world === null) {
      return undefined;
    }
    const layers = [...getWorldCompositionLayers(world)];
    const isRelevant = layers.some((layer) => {
      const tile = getRasterTileView(layer.raster, coord);
      return (
        tile !== undefined &&
        this.hasVisibleAlpha(tile, coord, work.tileSize, work.viewport)
      );
    });
    if (!isRelevant) {
      return undefined;
    }
    const signature = this.worldSignature(world, coord);
    const cached = this.resultCache.getCompatible(
      work.resultClass === "approximate" ? [key, `${key}:approximate`] : [key],
      signature,
      work.outputTileSize,
    );
    if (cached !== undefined) {
      if (cached.resultClass === "approximate") {
        this.worldApproximateCacheHits += 1;
      } else {
        this.worldCanonicalCacheHits += 1;
      }
      return { region: cached, isCached: true };
    }
    const startedAt = this.timingsEnabled ? performance.now() : 0;
    const pixels = this.composeWorldTile(
      layers,
      coord,
      work.tileSize,
      work.outputTileSize,
      work.resultClass,
    );
    if (this.timingsEnabled) {
      const durationMs = performance.now() - startedAt;
      this.compositionDurationMs += durationMs;
      if (work.resultClass === "approximate") {
        this.worldApproximateGenerationDurationMs += durationMs;
      } else {
        this.worldCanonicalGenerationDurationMs += durationMs;
      }
    }
    if (pixels === undefined) {
      return undefined;
    }
    const region: RenderRegion =
      work.resultClass === "approximate"
        ? { bounds, pixels, resultClass: "approximate" }
        : { bounds, pixels };
    if (work.resultClass === "approximate") {
      this.worldApproximateGeneratedCount += 1;
    } else {
      this.worldCanonicalGeneratedCount += 1;
    }
    this.resultCache.set(
      work.resultClass === "approximate" ? `${key}:approximate` : key,
      signature,
      region,
    );
    return { region, isCached: false };
  }

  /** Encodes ordered layer state and Tile versions without reading pixel buffers. */
  private worldSignature(world: World, coord: TileCoord): string {
    return JSON.stringify(
      world.layers.map((layer) => {
        const tile =
          layer.visible && layer.opacity > 0
            ? getRasterTileView(layer.raster, coord)
            : undefined;
        return [
          layer.id,
          layer.visible,
          layer.opacity,
          layer.blendMode,
          tile?.tileId ?? null,
          tile?.revision ?? null,
        ];
      }),
    );
  }

  /** Checks cached alpha coverage against the requested world area. */
  private hasVisibleAlpha(
    tile: RasterTileView,
    coord: TileCoord,
    tileSize: number,
    viewport: WorldRect,
  ): boolean {
    const bounds = this.tileRenderSummaries.get(tile, tileSize).alphaBounds;
    if (bounds === null) {
      return false;
    }
    const left = coord.x * tileSize + bounds.x;
    const top = coord.y * tileSize + bounds.y;
    return (
      left < viewport.x + viewport.width &&
      left + bounds.width > viewport.x &&
      top < viewport.y + viewport.height &&
      top + bounds.height > viewport.y
    );
  }

  /** Produces final straight-alpha RGBA8 pixels for one World tile. */
  private composeWorldTile(
    layers: readonly RasterLayer[],
    coord: TileCoord,
    tileSize: number,
    outputTileSize: number,
    resultClass: RenderResultClass,
  ): Uint8Array | undefined {
    const contributors = layers.flatMap((layer) => {
      const tile = getRasterTileView(layer.raster, coord);
      if (
        tile === undefined ||
        this.tileRenderSummaries.get(tile, tileSize).alphaBounds === null
      ) {
        return [];
      }
      return [{ layer, tile }];
    });
    if (contributors.length === 0) {
      return undefined;
    }
    if (resultClass === "approximate") {
      this.worldApproximateCompositionPixels +=
        contributors.length * outputTileSize ** 2;
      return composeWorldPreviewTile(contributors, tileSize, outputTileSize);
    }
    this.worldCanonicalCompositionPixels += contributors.length * tileSize ** 2;

    const composedPixels = new Uint8ClampedArray(tileSize * tileSize * 4);
    for (const { layer, tile } of contributors) {
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
    return this.downsamplePixels(composedPixels, tileSize, outputTileSize);
  }

  /** Converts source pixels to the exact output resolution requested for this pass. */
  private downsamplePixels(
    pixels: Uint8ClampedArray,
    tileSize: number,
    outputTileSize: number,
  ): Uint8Array {
    if (!this.timingsEnabled || tileSize === outputTileSize) {
      return new Uint8Array(
        downsampleRgbaTile(pixels, tileSize, outputTileSize),
      );
    }
    const startedAt = performance.now();
    const output = new Uint8Array(
      downsampleRgbaTile(pixels, tileSize, outputTileSize),
    );
    this.lodDurationMs += performance.now() - startedAt;
    return output;
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
      this.cancelledRequestCount += 1;
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
