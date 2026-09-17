import { Camera, CircleBrush, World } from "@reverie/core";
import type { Brush, RasterLayer, WorldBounds } from "@reverie/core";
import type { ExportRegion } from "@reverie/exporter";
import { CanvasRenderer } from "@reverie/renderer";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError } from "../errors/WebErrors.js";
import { downloadEncodedImage } from "../export/DownloadEncodedImage.js";
import { encodeRasterRegion } from "../export/EncodeRasterRegion.js";
import type { ReverieDownloadOptions } from "../interfaces/export/ReverieDownloadOptions.js";
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
   * @throws {WebRangeError} Dimensions are incomplete/invalid or the initial
   * stroke sequence is outside the uint32 range.
   * @throws Construction and attachment errors from owned dependencies when no
   * `onError` callback handles an attachment failure.
   */
  constructor(config: ReverieCanvasConfig) {
    const bounds = ReverieCanvas.resolveBounds(config.width, config.height);
    this.world = new World({
      bounds,
      ...(config.tileSize === undefined ? {} : { tileSize: config.tileSize }),
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
      ...(config.strokeSequence === undefined
        ? {}
        : { strokeSequence: config.strokeSequence }),
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

  /**
   * Encodes a region of the active layer and downloads it as an image file.
   *
   * The region defaults to the World's bounds, so a fixed canvas exports its
   * whole surface without extra configuration. An unbounded World has no natural
   * full-image size, so it requires an explicit `region`. Only the active layer is
   * exported; multi-layer compositing is not part of this step.
   *
   * The operation is read-only with respect to drawing state: neither the Raster,
   * the Camera, the Brush, nor the Scheduler is modified. JPEG downloads install
   * the runtime `Buffer` shim automatically, so callers never need to reach for
   * `JPEGEncoder.installJpegJsBufferShim()` themselves.
   *
   * @param options - Format, optional filename, optional region, and encoder options.
   * @returns A promise resolving once the browser download has been triggered.
   * @throws {WebError} This facade has been disposed.
   * @throws {WebRangeError} The World is unbounded and no `region` was supplied.
   * @throws {ExporterRangeError} The region is unusable or an encoder option is
   * outside its supported range.
   * @throws {ExporterError} The format backend failed to encode the bitmap.
   *
   * @example
   * await reverie.download({ format: "png", filename: "drawing" });
   */
  async download(options: ReverieDownloadOptions): Promise<void> {
    this.assertUsable();

    const region = ReverieCanvas.resolveExportRegion(
      this.world.bounds,
      options.region,
    );
    const image = await encodeRasterRegion(
      this.activeLayer.raster,
      region,
      options,
    );

    downloadEncodedImage(
      image,
      options.filename === undefined ? {} : { filename: options.filename },
    );
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

  /** Resolves the World bounds into the region a download should export. */
  private static resolveExportRegion(
    bounds: WorldBounds | null,
    region: ExportRegion | undefined,
  ): ExportRegion {
    if (region !== undefined) {
      return region;
    }

    if (bounds === null) {
      throw WebRangeError.from(WebErrorDefinitions.EXPORT_REGION_REQUIRED);
    }

    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  /** Rejects facade mutations after lifecycle disposal. */
  private assertUsable(): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.REVERIE_CANVAS_DISPOSED);
    }
  }
}
