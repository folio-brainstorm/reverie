import type { Camera, WorldRect } from "@reverie/core";
import {
  intersectRenderRegion,
  RenderingCore,
  resolveRenderSource,
} from "@reverie/core/renderer";
import type {
  RenderContinuation,
  RenderRequestIdentity,
  Renderer,
  RenderSource,
  RenderSourceSnapshot,
  TileCoord,
} from "@reverie/core/renderer";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import { RendererTypeError } from "../errors/RendererErrors.js";
import type { CanvasRendererConfig } from "../interfaces/CanvasRendererConfig.js";
import type { CanvasRendererDiagnostics } from "../interfaces/diagnostics/CanvasRendererDiagnostics.js";
import CanvasBackend from "./CanvasBackend.js";
import CanvasDiagnostics from "./CanvasDiagnostics.js";
import PresentationState from "./PresentationState.js";

/**
 * Coordinates Canvas renderer lifecycle with Rendering Core and its private
 * Canvas presentation backend.
 *
 * Rendering remains explicit: camera and source changes become visible only
 * after the caller invokes {@link render}.
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
  private nextRequestId = 1;
  private lastPresentedViewportKey: string | null = null;
  private sourceVersion = 0;
  private needsFreshRender = false;
  private interactiveTiles: readonly TileCoord[] = [];

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.backend.pixelRatio;
  }

  /** Whether this viewport has pending Core batches or a required refresh. */
  get hasPendingRender(): boolean {
    return (
      this.presentationState.pendingIdentity !== null || this.needsFreshRender
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
    this.renderingCore = new RenderingCore(
      config.diagnostics === undefined
        ? {}
        : { diagnostics: config.diagnostics },
    );
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
   * batch. Explicit changed Tiles may patch visible coverage early; only a
   * completed request reconciles the full viewport and removals.
   */
  render(): void {
    this.diagnosticCollector.beginRender();
    this.renderPass();
    this.diagnosticCollector.endRender();
  }

  /** Executes one explicit Core and Canvas presentation pass. */
  private renderPass(): void {
    const viewport = this.resolveViewport();
    if (viewport === null) {
      this.discardPresentation();
      this.diagnosticCollector.setRegionState(0, 0);
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
    if (this.lastPresentedViewportKey !== viewportKey) {
      this.presentationState.retainNear(viewport);
    }
    const visibleFrame = this.presentationState.visibleFrame;
    if (this.lastPresentedViewportKey !== viewportKey) {
      if (visibleFrame !== null) {
        this.backend.present(visibleFrame, this.backend.target);
      } else {
        this.backend.clear();
      }
      this.lastPresentedViewportKey = viewportKey;
    }
    const continuation = this.pendingContinuation;
    const pendingIdentity = this.presentationState.pendingIdentity;
    const isContinuation =
      continuation !== null &&
      pendingIdentity !== null &&
      pendingIdentity.viewportKey === viewportKey &&
      pendingIdentity.sourceRevision === sourceRevision;
    const identity = isContinuation
      ? pendingIdentity
      : this.createRequestIdentity(viewportKey, sourceRevision);
    const interactiveTiles = isContinuation ? [] : this.interactiveTiles;
    const regions = isContinuation
      ? this.renderingCore.continueRender(continuation)
      : this.renderingCore.render({
          source: this.renderSource,
          context: { scale },
          viewport,
          identity,
          interactiveTiles,
        });

    if (!isContinuation) {
      this.needsFreshRender = false;
      const tileSize =
        "raster" in this.renderSource
          ? this.renderSource.raster.tileSize
          : this.renderSource.world.tileSize;
      this.presentationState.begin(
        identity,
        new Set(
          interactiveTiles.map(
            ({ x, y }) =>
              `${x * tileSize}:${y * tileSize}:${tileSize}:${tileSize}`,
          ),
        ),
      );
      this.interactiveTiles = [];
    }
    this.pendingContinuation = regions.continuation ?? null;
    const commit = this.presentationState.append(regions);
    if (commit !== null) {
      this.diagnosticCollector.recordRemoved(commit.removedBounds.length);
      this.backend.clearRegions(commit.removedBounds);
      this.backend.presentRegions(commit.frame.regions);
    } else if (regions.identity.sourceRevision === sourceRevision) {
      const interactiveRegions =
        this.presentationState.applyInteractive(regions);
      if (interactiveRegions.length > 0) {
        this.backend.presentRegions(interactiveRegions);
      }
    }
    this.diagnosticCollector.setRegionState(
      this.presentationState.visibleRegionCount,
      this.presentationState.pendingRegionCount,
    );
  }

  /**
   * Marks live source edits and cancels obsolete partial output immediately.
   * @param interactiveTiles - Tiles touched by the latest drawing frame only.
   */
  markSourceChanged(interactiveTiles: readonly TileCoord[] = []): void {
    this.sourceVersion += 1;
    this.cancelPending();
    this.interactiveTiles = interactiveTiles.map(({ x, y }) => ({ x, y }));
    this.needsFreshRender = true;
  }

  /** Cancels partial work while retaining the last complete visible frame. */
  invalidate(): void {
    this.sourceVersion += 1;
    this.cancelPending();
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
    this.needsFreshRender = true;
  }

  /** Releases cached Canvas surfaces retained by the presentation backend. */
  dispose(): void {
    this.discardPresentation();
    this.backend.dispose();
  }

  /** Drops an obsolete continuation without deleting valid presentation. */
  private cancelPending(): void {
    this.pendingContinuation = null;
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
