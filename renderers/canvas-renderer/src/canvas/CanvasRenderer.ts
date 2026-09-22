import type { Camera, WorldRect } from "@reverie/core";
import {
  intersectRenderRegion,
  RenderingCore,
  resolveRenderSource,
} from "@reverie/core/renderer";
import type {
  Renderer,
  RenderSource,
  RenderSourceSnapshot,
} from "@reverie/core/renderer";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import { RendererTypeError } from "../errors/RendererErrors.js";
import type { CanvasRendererConfig } from "../interfaces/CanvasRendererConfig.js";
import CanvasBackend from "./CanvasBackend.js";

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

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.backend.pixelRatio;
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
   * Resolves the current viewport through Rendering Core and presents the
   * resulting region set through the Canvas backend.
   */
  render(): void {
    const viewport = this.resolveViewport();
    const regions =
      viewport === null
        ? { regions: [] }
        : this.renderingCore.render({
            source: this.renderSource,
            context: {
              scale: this.camera.zoom * this.pixelRatio,
            },
            viewport,
          });

    this.backend.present(regions, this.backend.target);
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
