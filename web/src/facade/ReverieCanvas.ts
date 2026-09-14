import { Camera, CircleBrush, World } from "@reverie/core";
import type { Brush, RasterLayer, WorldBounds } from "@reverie/core";
import { CanvasRenderer } from "@reverie/renderer";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError } from "../errors/WebErrors.js";
import type { ReverieCanvasConfig } from "../interfaces/facade/ReverieCanvasConfig.js";
import { CanvasDrawingSession } from "../session/CanvasDrawingSession.js";

const DEFAULT_BRUSH_SIZE = 1;
const DEFAULT_BRUSH_SPACING = 0.25;

/**
 * Composes the standard Web drawing runtime behind one convenience facade.
 *
 * The facade owns every object it creates and attaches input automatically.
 * Its exposed models remain available for advanced low-level control.
 */
export class ReverieCanvas {
  /** Document root carrying finite or infinite World semantics. */
  readonly world: World;

  /** Camera used by both pointer conversion and rendering. */
  readonly camera: Camera;

  /** Default bounded layer receiving all facade drawing. */
  readonly activeLayer: RasterLayer;

  /** Canvas renderer observing the active layer and camera. */
  readonly renderer: CanvasRenderer;

  /** Attached browser drawing Session owned by this facade. */
  readonly session: CanvasDrawingSession;

  private isDisposed = false;

  /** Returns the Brush that will be captured by the next Stroke. */
  get brush(): Brush {
    return this.session.brush;
  }

  /**
   * Creates and attaches a complete fixed or infinite canvas runtime.
   *
   * Omitting both dimensions creates an infinite World. Supplying both creates
   * a fixed World at origin `(0, 0)`.
   *
   * @param config - Canvas, optional dimensions, models, and runtime callbacks.
   * @throws {WebRangeError} Dimensions are incomplete or invalid.
   * @throws Construction and attachment errors from owned dependencies when no
   * `onError` callback handles an attachment failure.
   */
  constructor(config: ReverieCanvasConfig) {
    const bounds = ReverieCanvas.resolveBounds(config.width, config.height);
    this.world = new World({
      bounds,
      ...(config.tileSize === undefined
        ? {}
        : { tileSize: config.tileSize }),
    });
    this.activeLayer = this.world.createRasterLayer();
    this.camera = new Camera();
    this.renderer = new CanvasRenderer({
      canvas: config.canvas,
      raster: this.activeLayer.raster,
      camera: this.camera,
    });
    this.session = new CanvasDrawingSession({
      canvas: config.canvas,
      raster: this.activeLayer.raster,
      layer: this.activeLayer,
      camera: this.camera,
      renderer: this.renderer,
      brush: config.brush ?? ReverieCanvas.createDefaultBrush(),
      ...(config.frameBudget === undefined
        ? {}
        : { frameBudget: config.frameBudget }),
      ...(config.maxDevicePixelRatio === undefined
        ? {}
        : { maxDevicePixelRatio: config.maxDevicePixelRatio }),
      ...(config.onError === undefined ? {} : { onError: config.onError }),
      ...(config.onStrokeStart === undefined
        ? {}
        : { onStrokeStart: config.onStrokeStart }),
      ...(config.onStrokeEnd === undefined
        ? {}
        : { onStrokeEnd: config.onStrokeEnd }),
    });
    this.session.attach();
  }

  /**
   * Replaces the Brush captured by future Strokes.
   *
   * @param brush - Brush to use for the next Stroke.
   * @throws {WebError} This facade has been disposed.
   */
  setBrush(brush: Brush): void {
    this.assertUsable();
    this.session.setBrush(brush);
  }

  /**
   * Removes every pixel from the active layer and renders the empty canvas.
   *
   * @throws {WebError} This facade has been disposed.
   */
  clear(): void {
    this.assertUsable();
    this.activeLayer.raster.clear();
    this.renderer.render();
  }

  /**
   * Renders the current Raster and Camera state immediately.
   *
   * @throws {WebError} This facade has been disposed.
   */
  render(): void {
    this.assertUsable();
    this.renderer.render();
  }

  /** Releases input, resize, and owned scheduling resources permanently. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.session.dispose();
    this.isDisposed = true;
  }

  /** Creates the centralized default Brush used by zero-configuration canvases. */
  private static createDefaultBrush(): CircleBrush {
    return new CircleBrush({
      size: DEFAULT_BRUSH_SIZE,
      color: { r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      spacing: DEFAULT_BRUSH_SPACING,
    });
  }

  /** Resolves the facade dimension pair into fixed or infinite World bounds. */
  private static resolveBounds(
    width: unknown,
    height: unknown,
  ): WorldBounds | null {
    if (width === undefined && height === undefined) {
      return null;
    }

    const dimensionsAreValid =
      typeof width === "number" &&
      Number.isSafeInteger(width) &&
      width > 0 &&
      typeof height === "number" &&
      Number.isSafeInteger(height) &&
      height > 0;

    if (!dimensionsAreValid) {
      throw WebRangeError.from(
        WebErrorDefinitions.INVALID_REVERIE_CANVAS_DIMENSIONS,
      );
    }

    return { x: 0, y: 0, width, height };
  }

  /** Rejects facade mutations after lifecycle disposal. */
  private assertUsable(): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.REVERIE_CANVAS_DISPOSED);
    }
  }
}
