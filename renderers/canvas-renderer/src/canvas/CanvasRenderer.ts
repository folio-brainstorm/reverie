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
} from "@reverie/core/renderer";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import { RendererTypeError } from "../errors/RendererErrors.js";
import type { CanvasRendererConfig } from "../interfaces/CanvasRendererConfig.js";
import CanvasBackend from "./CanvasBackend.js";
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
  private readonly renderingCore = new RenderingCore();
  private readonly backend: CanvasBackend;
  private readonly presentationState = new PresentationState();
  private pendingContinuation: RenderContinuation | null = null;
  private nextRequestId = 1;
  private lastPresentedViewportKey: string | null = null;
  private sourceVersion = 0;
  private requestSourceVersion = 0;
  private needsFreshRender = false;

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
    this.backend = new CanvasBackend(
      config.canvas,
      config.camera,
      this.world?.bounds ?? null,
    );
  }

  /**
   * Resolves or advances the current viewport through Rendering Core.
   *
   * Repeated calls for an unchanged source and viewport pull the next partial
   * batch. Each returned batch patches the visible Canvas immediately.
   */
  render(): void {
    const viewport = this.resolveViewport();
    if (viewport === null) {
      this.invalidate();
      const identity = this.createRequestIdentity("empty", "empty");
      this.presentationState.begin(identity);
      this.presentationState.append({ identity, regions: [] });
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
      pendingIdentity.viewportKey === viewportKey;
    const identity = isContinuation
      ? pendingIdentity
      : this.createRequestIdentity(viewportKey, sourceRevision);
    const regions = isContinuation
      ? this.renderingCore.continueRender(continuation)
      : this.renderingCore.render({
          source: this.renderSource,
          context: { scale },
          viewport,
          identity,
        });

    if (!isContinuation) {
      this.requestSourceVersion = this.sourceVersion;
      this.needsFreshRender = false;
      this.presentationState.begin(identity);
    }
    this.pendingContinuation = regions.continuation ?? null;
    if (
      this.pendingContinuation === null &&
      this.requestSourceVersion !== this.sourceVersion
    ) {
      this.needsFreshRender = true;
    }
    const isAcceptedBatch = this.presentationState.append(regions);
    if (isAcceptedBatch) {
      this.backend.presentRegions(regions.regions);
    }
  }

  /** Marks live source edits while allowing the current batch sequence to finish. */
  markSourceChanged(): void {
    this.sourceVersion += 1;
    this.needsFreshRender = true;
  }

  /** Cancels a partial render so the next {@link render} starts from current data. */
  invalidate(): void {
    this.pendingContinuation = null;
    this.presentationState.invalidate();
    this.backend.clear();
    this.lastPresentedViewportKey = null;
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
  }

  /** Releases cached Canvas surfaces retained by the presentation backend. */
  dispose(): void {
    this.invalidate();
    this.backend.dispose();
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
