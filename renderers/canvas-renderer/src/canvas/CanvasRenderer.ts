import type { Camera, WorldRect } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";
import {
  intersectRenderRegion,
  resolveRenderSource,
} from "@reveriejs/core/rendering/internal";
import type {
  RenderContinuation,
  RenderQualityMode,
  RenderRegion,
  RenderRegionSet,
  Renderer,
  RenderSource,
  TileCoord,
} from "@reveriejs/core/rendering";
import type {
  RenderRequestIdentity,
  RenderSourceSnapshot,
} from "@reveriejs/core/rendering/internal";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import {
  RendererRangeError,
  RendererTypeError,
} from "../errors/RendererErrors.js";
import type { CanvasRendererConfig } from "../interfaces/CanvasRendererConfig.js";
import type { CanvasRenderOptions } from "../interfaces/CanvasRenderOptions.js";
import type { CoveragePlan } from "../interfaces/prefetch/CoveragePlan.js";
import type { CanvasDiagnosticsOptions } from "../interfaces/diagnostics/CanvasDiagnosticsOptions.js";
import type { CanvasRendererDiagnostics } from "../interfaces/diagnostics/CanvasRendererDiagnostics.js";
import type { PresentationCacheContext } from "../interfaces/presentation/PresentationCacheContext.js";
import CanvasBackend from "./CanvasBackend.js";
import CanvasDiagnostics from "./CanvasDiagnostics.js";
import CoveragePolicy from "./CoveragePolicy.js";
import PresentationState from "./PresentationState.js";
import { MAX_INTERACTIVE_PRESENTATION_SCALE } from "./PresentationDensity.js";

const PRESSURE_VISIBLE_TILE_THRESHOLD = 64;
const PRESSURE_VELOCITY_THRESHOLD = 1.5;
const MIN_WARM_HEADROOM_MS = 2;

/**
 * Coordinates Canvas renderer lifecycle with Rendering Core and its private
 * Canvas presentation backend.
 *
 * Rendering remains explicit: camera and source changes become visible only
 * after the caller invokes {@link render}.
 * Report source edits through {@link markSourceChanged} or {@link invalidate}
 * before reusing retained results across camera positions.
 */
export class CanvasRenderer<
  Config extends CanvasRendererConfig = CanvasRendererConfig,
> implements Renderer {
  /** Canvas whose backing buffer receives each rendered frame. */
  readonly canvas: HTMLCanvasElement;

  /** Sparse raster observed without allocation or mutation. */
  get raster(): Config["raster"] {
    return this.source.raster;
  }

  /** Document composed when the renderer was configured with a World. */
  get world(): Config["world"] {
    return this.source.world;
  }

  /** Camera used as the world-to-screen projection for every frame. */
  readonly camera: Camera;

  private readonly source: RenderSourceSnapshot<Config>;
  private readonly renderSource: RenderSource;
  private readonly renderingCore: RenderingCore;
  /** Read-only grouped measurements for this renderer and its Core. */
  readonly diagnostics: CanvasRendererDiagnostics;
  private readonly diagnosticCollector: CanvasDiagnostics;
  private readonly backend: CanvasBackend;
  private readonly presentationState = new PresentationState();
  private pendingContinuation: RenderContinuation | null = null;
  private warmContinuation: RenderContinuation | null = null;
  private warmStage: "forward" | "base" | null = null;
  private pendingWarmRequestKey: string | null = null;
  private lastWarmCompletedKey: string | null = null;
  private nextRequestId = 1;
  private lastPresentedViewportKey: string | null = null;
  /** Canvas-visible immutable results for the current projection epoch. */
  private readonly presentedPixels = new Map<string, Uint8Array>();
  private sourceVersion = 0;
  private needsFreshRender = false;
  private interactiveTiles: readonly TileCoord[] = [];
  private lastMotionX: number | null = null;
  private lastMotionY: number | null = null;
  private lastMotionTime = 0;
  private velocityPixelsPerMs = 0;
  private directionX: -1 | 0 | 1 = 0;
  private directionY: -1 | 0 | 1 = 0;
  private currentRenderScale = 1;

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.backend.pixelRatio;
  }

  /** Whether this viewport has pending Core batches or a required refresh. */
  get hasPendingRender(): boolean {
    return (
      this.presentationState.pendingIdentity !== null ||
      this.needsFreshRender ||
      this.pendingWarmRequestKey !== null
    );
  }

  /**
   * Creates a Canvas renderer bound to one source and camera.
   *
   * The renderer does not own the lifecycle of any supplied dependency.
   *
   * @param config - Canvas output, exactly one source, and Camera to observe.
   * @throws {RendererTypeError} Both rendering sources or neither are supplied.
   */
  constructor(config: Config) {
    this.source = resolveRenderSource(config, () =>
      RendererTypeError.from(RendererErrorDefinitions.INVALID_RENDER_SOURCE),
    );
    this.renderSource = CanvasRenderer.toRenderSource(this.source);
    this.canvas = config.canvas;
    this.camera = config.camera;
    this.renderingCore = new RenderingCore({
      ...(config.diagnostics === undefined
        ? {}
        : { diagnostics: config.diagnostics }),
      ...(config.resultCacheByteBudget === undefined
        ? {}
        : { resultCacheByteBudget: config.resultCacheByteBudget }),
    });
    this.diagnosticCollector = new CanvasDiagnostics(
      this.renderingCore,
      config.diagnostics?.timings === true,
    );
    this.diagnostics = this.diagnosticCollector;
    this.backend = new CanvasBackend(
      config.canvas,
      config.camera,
      this.world?.bounds ?? null,
      this.diagnosticCollector,
    );
  }

  /**
   * Resolves or advances the current viewport through Rendering Core.
   *
   * Repeated calls for an unchanged source and viewport pull the next partial
   * batch. Safe completed regions may patch visible coverage early; only a
   * completed request reconciles the full viewport and removals.
   * @param options - Quality, prefetch intent, and advisory warm-work headroom.
   * @throws {RendererTypeError} The requested quality is unsupported.
   * @throws {RendererRangeError} The frame-budget hint is invalid.
   */
  render(options: CanvasRenderOptions = {}): void {
    const quality = options.quality ?? "full";
    if (quality !== "full" && quality !== "interactive") {
      throw RendererTypeError.from(
        RendererErrorDefinitions.INVALID_RENDER_QUALITY,
      );
    }
    const remainingFrameBudgetMs = options.remainingFrameBudgetMs;
    if (
      remainingFrameBudgetMs !== undefined &&
      (!Number.isFinite(remainingFrameBudgetMs) || remainingFrameBudgetMs < 0)
    ) {
      throw RendererRangeError.from(
        RendererErrorDefinitions.INVALID_FRAME_BUDGET_HINT,
      );
    }
    this.diagnosticCollector.beginRender(quality);
    this.renderPass(quality, options.prefetch === true, remainingFrameBudgetMs);
    this.diagnosticCollector.endRender();
  }

  /**
   * Changes timing collection for later render passes without resetting counters.
   * A transition clears previous timing samples so reopening diagnostics begins
   * a fresh measurement window.
   * @param options - Enable or disable Core and Canvas stage timings.
   * @throws {RendererTypeError} The `timings` option is invalid at runtime.
   */
  configureDiagnostics(options: CanvasDiagnosticsOptions): void {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      (options.timings !== undefined && typeof options.timings !== "boolean")
    ) {
      throw RendererTypeError.from(
        RendererErrorDefinitions.INVALID_DIAGNOSTICS_OPTIONS,
      );
    }
    const isEnabled = options.timings === true;
    this.renderingCore.setTimingDiagnosticsEnabled(isEnabled);
    this.diagnosticCollector.setTimingsEnabled(isEnabled);
  }

  /**
   * Records a Web camera request for public scheduler diagnostics.
   * @param isCoalesced - Whether an earlier view request already owns the frame.
   */
  recordViewRenderRequest(isCoalesced: boolean): void {
    this.diagnosticCollector.recordViewRequest(isCoalesced);
  }

  /** Records a Web frame that executed the latest camera request. */
  recordViewRenderExecution(): void {
    this.diagnosticCollector.recordViewExecution();
  }

  /** Executes one explicit Core and Canvas presentation pass. */
  private renderPass(
    quality: RenderQualityMode,
    prefetch: boolean,
    remainingFrameBudgetMs?: number,
  ): void {
    const viewport = this.resolveViewport();
    if (viewport === null) {
      this.handleEmptyViewport();
      return;
    }

    const scale = this.camera.zoom * this.pixelRatio;
    const viewportKey = CanvasRenderer.createViewportKey(
      viewport,
      scale,
      this.camera.panX,
      this.camera.panY,
    );
    const sourceRevision = String(this.sourceVersion);
    const tileSize =
      "raster" in this.renderSource
        ? this.renderSource.raster.tileSize
        : this.renderSource.world.tileSize;
    this.updateMotion(quality);
    const coverage = CoveragePolicy.resolve(
      tileSize,
      this.camera.zoom,
      this.velocityPixelsPerMs,
      this.directionX,
      this.directionY,
    );
    const visibleTileEstimate =
      Math.ceil(viewport.width / tileSize) *
      Math.ceil(viewport.height / tileSize);
    const hasCoveragePressure =
      quality === "interactive" &&
      (visibleTileEstimate > PRESSURE_VISIBLE_TILE_THRESHOLD ||
        coverage.velocityPixelsPerMs >= PRESSURE_VELOCITY_THRESHOLD);
    // Movement pressure remains diagnostic; it must not add a second LOD drop.
    let renderScale = scale;
    if (quality === "interactive") {
      const minimumOutputSize = Math.min(
        tileSize,
        (tileSize * scale) / MAX_INTERACTIVE_PRESENTATION_SCALE,
      );
      while (
        this.renderingCore.resolveOutputTileSize(tileSize, {
          scale: renderScale,
          quality,
        }) < minimumOutputSize
      ) {
        renderScale *= 2;
      }
    }
    this.currentRenderScale = renderScale;
    const renderContext = { scale: renderScale, quality };
    const outputTileSize = this.renderingCore.resolveOutputTileSize(
      tileSize,
      renderContext,
    );
    const cacheContext: PresentationCacheContext = {
      viewport,
      sourceRevision,
      scaleKey: String(scale),
      panX: this.camera.panX,
      panY: this.camera.panY,
      quality,
      outputTileSize,
      resultClass:
        "world" in this.renderSource &&
        quality === "interactive" &&
        outputTileSize < tileSize
          ? "approximate"
          : "canonical",
    };
    this.diagnosticCollector.setCoveragePolicy(
      coverage,
      hasCoveragePressure,
      cacheContext.outputTileSize,
    );
    const requestKey = `${viewportKey}:${sourceRevision}:${quality}`;
    const isViewportChanged = this.lastPresentedViewportKey !== viewportKey;
    if (!prefetch) {
      this.pendingWarmRequestKey = null;
      this.warmContinuation = null;
      this.warmStage = null;
    }
    if (
      this.pendingWarmRequestKey !== null &&
      this.pendingWarmRequestKey !== requestKey
    ) {
      this.pendingWarmRequestKey = null;
      this.warmContinuation = null;
      this.warmStage = null;
    }
    if (this.lastPresentedViewportKey !== viewportKey) {
      this.presentationState.retainNear(
        viewport,
        tileSize * coverage.retainMarginTiles,
      );
      this.backend.retainNear(viewport, tileSize * coverage.retainMarginTiles);
    }
    const projectedRegions = isViewportChanged
      ? this.presentationState.getProvisionalRegions(cacheContext)
      : [];
    if (projectedRegions.length > 0) {
      this.diagnosticCollector.recordCoverage(projectedRegions.length, 0, 0, 0);
    }
    const visibleFrame = this.presentationState.visibleFrame;
    if (this.lastPresentedViewportKey !== viewportKey) {
      this.presentedPixels.clear();
      if (visibleFrame?.identity.sourceRevision === sourceRevision) {
        // Every completed region is retained before presentation. Select one
        // cached variant per visible coordinate before drawing the projection.
        this.backend.present(
          { ...visibleFrame, regions: projectedRegions },
          this.backend.target,
        );
        this.rememberPresented(projectedRegions);
      } else {
        this.backend.clear();
        this.presentUnseenRegions(projectedRegions);
      }
      this.lastPresentedViewportKey = viewportKey;
    }
    if (
      this.pendingWarmRequestKey === requestKey &&
      this.presentationState.pendingIdentity === null &&
      !this.needsFreshRender
    ) {
      if (
        remainingFrameBudgetMs !== undefined &&
        remainingFrameBudgetMs < MIN_WARM_HEADROOM_MS
      ) {
        this.diagnosticCollector.recordWarmDeferral();
        this.recordZoneState(viewport, tileSize, coverage);
      } else {
        this.renderWarmPass(cacheContext, requestKey, tileSize, coverage);
      }
      return;
    }
    const continuation = this.pendingContinuation;
    const pendingIdentity = this.presentationState.pendingIdentity;
    const isContinuation =
      continuation !== null &&
      pendingIdentity !== null &&
      pendingIdentity.viewportKey === viewportKey &&
      pendingIdentity.sourceRevision === sourceRevision &&
      this.presentationState.pendingOutputTileSize ===
        cacheContext.outputTileSize &&
      this.presentationState.pendingResultClass === cacheContext.resultClass;
    const identity = isContinuation
      ? pendingIdentity
      : this.createRequestIdentity(viewportKey, sourceRevision);
    const interactiveTiles = isContinuation ? [] : this.interactiveTiles;
    const reusableRegions = isContinuation
      ? []
      : this.presentationState.getReusableRegions(cacheContext);
    if (reusableRegions.length > 0) {
      this.diagnosticCollector.recordCoverage(0, reusableRegions.length, 0, 0);
    }
    const regions = isContinuation
      ? this.renderingCore.continueRender(continuation)
      : this.renderingCore.render({
          source: this.renderSource,
          context: renderContext,
          viewport,
          identity,
          interactiveTiles,
          skipTiles: reusableRegions.map((region) => ({
            x: region.bounds.x / tileSize,
            y: region.bounds.y / tileSize,
          })),
        });

    if (!isContinuation) {
      this.needsFreshRender = false;
      this.presentationState.begin(identity, cacheContext, reusableRegions);
      this.interactiveTiles = [];
    }
    this.pendingContinuation = regions.continuation ?? null;
    this.diagnosticCollector.recordCoverage(0, 0, 0, regions.regions.length);
    const commit = this.presentationState.append(regions);
    if (commit !== null) {
      this.diagnosticCollector.recordRemoved(commit.removedBounds.length);
      this.backend.clearRegions(commit.removedBounds);
      for (const bounds of commit.removedBounds) {
        this.presentedPixels.delete(CanvasRenderer.regionKey(bounds));
      }
      const completionDeltaCount = this.presentUnseenRegions(
        commit.frame.regions,
      );
      this.diagnosticCollector.recordCompletionDelta(completionDeltaCount);
      if (prefetch && this.lastWarmCompletedKey !== requestKey) {
        this.pendingWarmRequestKey = requestKey;
        this.warmStage = coverage.lookaheadTiles > 0 ? "forward" : "base";
      }
    } else if (regions.identity.sourceRevision === sourceRevision) {
      const provisionalRegions =
        this.presentationState.applyProvisional(regions);
      if (provisionalRegions.length > 0) {
        this.diagnosticCollector.recordCoverage(
          0,
          0,
          provisionalRegions.length,
          0,
        );
        this.presentUnseenRegions(provisionalRegions);
      }
    }
    this.diagnosticCollector.setRegionState(
      this.presentationState.visibleRegionCount,
      this.presentationState.pendingRegionCount,
    );
    this.recordZoneState(viewport, tileSize, coverage);
  }

  /** Draws only results absent from the target under this projection epoch. */
  private presentUnseenRegions(regions: readonly RenderRegion[]): number {
    const delta = regions.filter(
      (region) =>
        this.presentedPixels.get(CanvasRenderer.regionKey(region.bounds)) !==
        region.pixels,
    );
    this.diagnosticCollector.recordAlreadyPresented(
      regions.length - delta.length,
    );
    if (delta.length > 0) {
      this.backend.presentRegions(delta);
      this.rememberPresented(delta);
    }
    return delta.length;
  }

  /** Records pixels only after the backend has drawn them successfully. */
  private rememberPresented(regions: readonly RenderRegion[]): void {
    for (const region of regions) {
      this.presentedPixels.set(
        CanvasRenderer.regionKey(region.bounds),
        region.pixels,
      );
    }
  }

  /** Uses exact world bounds to distinguish projected Region placements. */
  private static regionKey(bounds: WorldRect): string {
    return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
  }

  /** Keeps nearby pixels when a bounded World temporarily leaves the screen. */
  private handleEmptyViewport(): void {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) {
      this.discardPresentation();
      this.diagnosticCollector.setZoneState(0, 0, 0);
      return;
    }
    const viewport = this.camera.visibleWorldRect({
      width: width / this.pixelRatio,
      height: height / this.pixelRatio,
    });
    if (!CanvasRenderer.isFiniteViewport(viewport)) {
      this.discardPresentation();
      this.diagnosticCollector.setZoneState(0, 0, 0);
      return;
    }
    const tileSize =
      "raster" in this.renderSource
        ? this.renderSource.raster.tileSize
        : this.renderSource.world.tileSize;
    const coverage = CoveragePolicy.resolve(
      tileSize,
      this.camera.zoom,
      0,
      0,
      0,
    );
    this.cancelPending();
    this.presentationState.retainNear(
      viewport,
      tileSize * coverage.retainMarginTiles,
    );
    this.backend.retainNear(viewport, tileSize * coverage.retainMarginTiles);
    this.presentationState.clearVisible();
    this.backend.clear();
    this.presentedPixels.clear();
    this.lastPresentedViewportKey = null;
    this.needsFreshRender = false;
    this.diagnosticCollector.setRegionState(0, 0);
    this.recordZoneState(viewport, tileSize, coverage);
  }

  /** Resolves only warm-zone Tiles after visible work has completed. */
  private renderWarmPass(
    cacheContext: PresentationCacheContext,
    requestKey: string,
    tileSize: number,
    coverage: CoveragePlan,
  ): void {
    const stage = this.warmStage ?? "base";
    const warmViewport =
      stage === "forward"
        ? this.resolveForwardViewport(cacheContext.viewport, tileSize, coverage)
        : this.expandViewport(
            cacheContext.viewport,
            tileSize * coverage.renderMarginTiles,
          );
    if (warmViewport === null) {
      this.finishWarmStage(requestKey, stage);
      return;
    }
    this.diagnosticCollector.recordWarmExecution();
    const continuation = this.warmContinuation;
    const regions: RenderRegionSet =
      continuation === null
        ? this.renderingCore.render({
            source: this.renderSource,
            context: {
              scale: this.currentRenderScale,
              quality: cacheContext.quality,
            },
            viewport: warmViewport,
            excludeViewport: cacheContext.viewport,
            skipTiles: this.presentationState
              .getReusableRegions({ ...cacheContext, viewport: warmViewport })
              .map((region) => ({
                x: region.bounds.x / tileSize,
                y: region.bounds.y / tileSize,
              })),
            identity: this.createRequestIdentity(
              `${requestKey}:warm:${stage}`,
              cacheContext.sourceRevision,
            ),
          })
        : this.renderingCore.continueRender(continuation);
    this.presentationState.addWarmRegions(regions.regions, cacheContext);
    this.diagnosticCollector.recordWarmMisses(regions.regions.length);
    const batch = this.renderingCore.getLastDiagnostics();
    const completedCount =
      batch.renderedTileCount +
      this.renderingCore.getDiagnosticsSnapshot().tiles.renderEmptyCount;
    this.diagnosticCollector.recordPrefetch(
      batch.candidateTileCount,
      completedCount,
    );
    this.warmContinuation = regions.continuation ?? null;
    if (this.warmContinuation === null) {
      this.finishWarmStage(requestKey, stage);
    }
    this.recordZoneState(cacheContext.viewport, tileSize, coverage);
  }

  /** Advances the two bounded warm stages without mixing their continuations. */
  private finishWarmStage(requestKey: string, stage: "forward" | "base"): void {
    this.warmContinuation = null;
    if (stage === "forward") {
      this.warmStage = "base";
      return;
    }
    this.warmStage = null;
    this.pendingWarmRequestKey = null;
    this.lastWarmCompletedKey = requestKey;
  }

  /** Returns only the forward strip, so its candidates precede other warm work. */
  private resolveForwardViewport(
    viewport: WorldRect,
    tileSize: number,
    coverage: CoveragePlan,
  ): WorldRect | null {
    const margin = tileSize * coverage.renderMarginTiles;
    const depth = margin + tileSize * coverage.lookaheadTiles;
    let forward: WorldRect;
    if (coverage.directionX !== 0) {
      forward = {
        x:
          coverage.directionX > 0
            ? viewport.x + viewport.width
            : viewport.x - depth,
        y: viewport.y - margin,
        width: depth,
        height: viewport.height + margin * 2,
      };
    } else if (coverage.directionY !== 0) {
      forward = {
        x: viewport.x - margin,
        y:
          coverage.directionY > 0
            ? viewport.y + viewport.height
            : viewport.y - depth,
        width: viewport.width + margin * 2,
        height: depth,
      };
    } else {
      return null;
    }
    return CanvasRenderer.isFiniteViewport(forward)
      ? intersectRenderRegion(forward, this.world?.bounds ?? null)
      : null;
  }

  /** Expands a viewport in world pixels while preserving bounded World clips. */
  private expandViewport(
    viewport: WorldRect,
    margin: number,
  ): WorldRect | null {
    const expanded = {
      x: viewport.x - margin,
      y: viewport.y - margin,
      width: viewport.width + margin * 2,
      height: viewport.height + margin * 2,
    };
    if (!CanvasRenderer.isFiniteViewport(expanded)) {
      return null;
    }
    return intersectRenderRegion(expanded, this.world?.bounds ?? null);
  }

  /** Publishes measured sparse result counts for the three live zones. */
  private recordZoneState(
    viewport: WorldRect,
    tileSize: number,
    coverage: CoveragePlan,
  ): void {
    const warmViewport = this.expandViewport(
      viewport,
      tileSize * coverage.renderMarginTiles,
    );
    const counts = this.presentationState.getZoneCounts(
      viewport,
      warmViewport ?? viewport,
    );
    this.diagnosticCollector.setZoneState(
      counts.visible,
      counts.warm,
      counts.retained,
    );
  }

  /** Samples host camera movement only when its position changes. */
  private updateMotion(quality: RenderQualityMode): void {
    const now = performance.now();
    const panX = this.camera.panX;
    const panY = this.camera.panY;
    const deltaX = this.lastMotionX === null ? 0 : panX - this.lastMotionX;
    const deltaY = this.lastMotionY === null ? 0 : panY - this.lastMotionY;
    if (quality === "full") {
      this.velocityPixelsPerMs = 0;
      this.directionX = 0;
      this.directionY = 0;
    } else if (deltaX !== 0 || deltaY !== 0) {
      const elapsedMs = Math.max(16, now - this.lastMotionTime);
      this.velocityPixelsPerMs = Math.min(
        100,
        (Math.hypot(deltaX, deltaY) * this.camera.zoom) / elapsedMs,
      );
      this.directionX =
        Math.abs(deltaX) >= Math.abs(deltaY) ? (deltaX > 0 ? 1 : -1) : 0;
      this.directionY =
        Math.abs(deltaY) > Math.abs(deltaX) ? (deltaY > 0 ? 1 : -1) : 0;
    }
    if (
      quality === "full" ||
      deltaX !== 0 ||
      deltaY !== 0 ||
      this.lastMotionX === null
    ) {
      this.lastMotionX = panX;
      this.lastMotionY = panY;
      this.lastMotionTime = now;
    }
  }

  /**
   * Marks live source edits and cancels obsolete partial output immediately.
   * @param interactiveTiles - Tiles touched by the latest drawing frame only.
   */
  markSourceChanged(interactiveTiles: readonly TileCoord[] = []): void {
    this.sourceVersion += 1;
    this.cancelPending();
    this.presentationState.retainSourceChanges(
      String(this.sourceVersion),
      interactiveTiles,
      "raster" in this.renderSource
        ? this.renderSource.raster.tileSize
        : this.renderSource.world.tileSize,
    );
    this.interactiveTiles = interactiveTiles.map(({ x, y }) => ({ x, y }));
    this.needsFreshRender = true;
  }

  /** Cancels partial work while retaining the last complete visible frame. */
  invalidate(): void {
    this.sourceVersion += 1;
    this.cancelPending();
    this.presentationState.clearRetained();
    this.interactiveTiles = [];
    this.needsFreshRender = true;
  }

  /**
   * Changes the canvas backing-buffer dimensions used as the screen viewport.
   *
   * Resizing does not render automatically. Zero-sized canvases are valid.
   *
   * @param width - Non-negative finite integer width in backing pixels.
   * @param height - Non-negative finite integer height in backing pixels.
   * @param pixelRatio - Positive finite backing pixels per CSS pixel.
   */
  resize(width: number, height: number, pixelRatio = 1): void {
    this.backend.resize(width, height, pixelRatio);
    this.cancelPending();
    this.interactiveTiles = [];
    this.lastPresentedViewportKey = null;
    this.presentedPixels.clear();
    this.needsFreshRender = true;
  }

  /** Releases presentation surfaces and the owned Core result cache. */
  dispose(): void {
    this.discardPresentation();
    this.backend.dispose();
    this.renderingCore.dispose();
  }

  /** Drops an obsolete continuation without deleting valid presentation. */
  private cancelPending(): void {
    this.pendingContinuation = null;
    this.warmContinuation = null;
    this.warmStage = null;
    this.pendingWarmRequestKey = null;
    this.renderingCore.cancelPendingRender();
    this.presentationState.cancelPending();
    this.diagnosticCollector.setRegionState(
      this.presentationState.visibleRegionCount,
      0,
    );
  }

  /** Clears output when its current viewport cannot present a valid frame. */
  private discardPresentation(): void {
    this.cancelPending();
    this.interactiveTiles = [];
    this.presentationState.discard();
    this.backend.clear();
    this.presentedPixels.clear();
    this.lastPresentedViewportKey = null;
    this.needsFreshRender = false;
    this.diagnosticCollector.setRegionState(0, 0);
  }

  /** Resolves the bounded source viewport requested for the next frame. */
  private resolveViewport(): WorldRect | null {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) {
      return null;
    }

    const viewport = intersectRenderRegion(
      this.camera.visibleWorldRect({
        width: width / this.pixelRatio,
        height: height / this.pixelRatio,
      }),
      this.world?.bounds ?? null,
    );

    if (viewport === null || !CanvasRenderer.isFiniteViewport(viewport)) {
      return null;
    }
    return viewport;
  }

  /** Prevents invalid camera projections from crossing the Core boundary. */
  private static isFiniteViewport(viewport: WorldRect): boolean {
    return Object.values(viewport).every(Number.isFinite);
  }

  /** Captures both source coverage and the projection used to draw it. */
  private static createViewportKey(
    viewport: WorldRect,
    scale: number,
    panX: number,
    panY: number,
  ): string {
    return `${viewport.x}:${viewport.y}:${viewport.width}:${viewport.height}:${scale}:${panX}:${panY}`;
  }

  /** Allocates one renderer-local identity for a fresh presentation request. */
  private createRequestIdentity(
    viewportKey: string,
    sourceRevision: string,
  ): RenderRequestIdentity {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return { requestId, viewportKey, sourceRevision };
  }

  /** Converts a validated snapshot into Rendering Core's source contract. */
  private static toRenderSource(
    source: RenderSourceSnapshot<CanvasRendererConfig>,
  ): RenderSource {
    if (source.raster !== undefined) {
      return { raster: source.raster };
    }
    if (source.world !== undefined) {
      return { world: source.world };
    }
    throw RendererTypeError.from(
      RendererErrorDefinitions.INVALID_RENDER_SOURCE,
    );
  }
}
