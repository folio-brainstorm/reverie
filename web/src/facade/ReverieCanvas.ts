import { Camera, CircleBrush, World } from "@reverie/core";
import type {
  Brush,
  LayerBlendMode,
  PaintMode,
  RasterLayer,
  SelectionMask,
  WorldBounds,
} from "@reverie/core";
import type { ExportRegion } from "@reverie/exporter";
import { CanvasRenderer } from "@reverie/canvas-renderer";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError, WebTypeError } from "../errors/WebErrors.js";
import { downloadEncodedImage } from "../export/DownloadEncodedImage.js";
import { encodeWorldRegion } from "../export/EncodeWorldRegion.js";
import type { ReverieDownloadOptions } from "../interfaces/export/ReverieDownloadOptions.js";
import type { ReverieCanvasConfig } from "../interfaces/facade/ReverieCanvasConfig.js";
import { CanvasDrawingSession } from "../session/CanvasDrawingSession.js";

const DEFAULT_BRUSH_SIZE = 1;
const DEFAULT_BRUSH_SPACING = 0.25;

/**
 * Composes the standard Web drawing runtime behind one convenience facade.
 *
 * The facade owns its browser runtime attachments and attaches input
 * automatically. It can create a World or adopt a caller-supplied World without
 * changing that document's state.
 */
export class ReverieCanvas {
  /** Document root carrying finite or infinite World semantics. */
  readonly world: World;

  /** Camera used by both pointer conversion and rendering. */
  readonly camera: Camera;

  /** Session selection, intentionally separate from the World document model. */
  private currentActiveLayer: RasterLayer;

  /** Selected editing target; composition remains independent of selection. */
  get activeLayer(): RasterLayer {
    return this.currentActiveLayer;
  }

  /** Canvas renderer composing the whole World through the camera. */
  readonly renderer: CanvasRenderer;

  /** Attached browser drawing Session owned by this facade. */
  readonly session: CanvasDrawingSession;

  private isDisposed = false;
  private readonly stopObservingLayerRemoval: () => void;

  /** Returns the Brush that will be captured by the next Stroke. */
  get brush(): Brush {
    return this.session.brush;
  }

  /** Returns the operation that will be captured by the next Stroke. */
  get paintMode(): PaintMode {
    return this.session.paintMode;
  }

  /** Returns the transient Selection captured by the next Stroke. */
  get selection(): SelectionMask | null {
    return this.session.selection;
  }

  /** Returns whether one committed document edit can currently be undone. */
  get canUndo(): boolean {
    return this.session.canUndo;
  }

  /** Returns whether one previously undone document edit can currently be redone. */
  get canRedo(): boolean {
    return this.session.canRedo;
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
   * @throws {WebTypeError} An initial World is invalid or conflicts with geometry.
   * @throws Construction and attachment errors from owned dependencies when no
   * `onError` callback handles an attachment failure.
   */
  constructor(config: ReverieCanvasConfig) {
    this.world = ReverieCanvas.resolveWorld(config);
    this.currentActiveLayer = this.world.getLayer(0);
    this.camera = new Camera();
    this.renderer = new CanvasRenderer({
      canvas: config.canvas,
      world: this.world,
      camera: this.camera,
    });
    this.session = new CanvasDrawingSession({
      canvas: config.canvas,
      raster: this.activeLayer.raster,
      layer: this.activeLayer,
      world: this.world,
      camera: this.camera,
      renderer: this.renderer,
      brush: config.brush ?? ReverieCanvas.createDefaultBrush(),
      ...(config.paintMode === undefined
        ? {}
        : { paintMode: config.paintMode }),
      ...(config.selection === undefined
        ? {}
        : { selection: config.selection }),
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
    this.stopObservingLayerRemoval = this.session.observeLayerRemoval(
      this.world,
      (layer) => {
        this.currentActiveLayer = layer;
      },
    );
    this.session.attach();
  }

  /** Resolves mutually exclusive creation geometry or an adopted World. */
  private static resolveWorld(config: ReverieCanvasConfig): World {
    if (config.world !== undefined) {
      if (
        !(config.world instanceof World) ||
        config.width !== undefined ||
        config.height !== undefined ||
        config.tileSize !== undefined
      ) {
        throw WebTypeError.from(WebErrorDefinitions.INCOMPATIBLE_INITIAL_WORLD);
      }
      return config.world;
    }
    const bounds = ReverieCanvas.resolveBounds(config.width, config.height);
    return new World({
      bounds,
      ...(config.tileSize === undefined ? {} : { tileSize: config.tileSize }),
    });
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
   * Replaces the operation captured by future strokes on the active layer.
   * @param paintMode - Supported operation to capture for the next stroke.
   * @throws {WebError} This facade has been disposed.
   */
  setPaintMode(paintMode: PaintMode): void {
    this.assertUsable();
    this.session.setPaintMode(paintMode);
  }

  /**
   * Replaces the transient Selection captured by future strokes.
   *
   * @param selection - SelectionMask to apply, or null for unrestricted writes.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   * @throws {WebTypeError} The supplied value is not a SelectionMask or null.
   */
  setSelection(selection: SelectionMask | null): void {
    this.assertUsable();
    this.session.setSelection(selection);
  }

  /**
   * Selects a member layer for subsequent drawing without changing composition.
   * @param layer - World member reference or bottom-to-top index.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   * @throws {ReverieRangeError} The index does not belong to this World.
   * @throws {ReverieError} The reference does not belong to this World.
   */
  setActiveLayer(layer: RasterLayer | number): void {
    this.assertUsable();
    const member = this.world.getLayer(layer);
    if (member === this.activeLayer) {
      return;
    }
    this.session.setLayer(member);
    this.currentActiveLayer = member;
  }

  /**
   * Adds and selects one empty top Layer as a reversible document edit.
   *
   * @returns The new active Layer.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   */
  addLayer(): RasterLayer {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    const layer = this.world.addLayer();
    this.session.setLayer(layer);
    this.currentActiveLayer = layer;
    this.renderer.render();
    return layer;
  }

  /**
   * Moves a Layer to a final bottom-to-top index as one reversible edit.
   *
   * @param layer - World member reference or current index.
   * @param index - Final index in the unchanged Layer collection.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   * @throws {ReverieRangeError} Either index is outside the World collection.
   * @throws {ReverieError} The referenced Layer is not a World member.
   */
  moveLayer(layer: RasterLayer | number, index: number): void {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    this.world.moveLayer(layer, index);
    this.renderer.render();
  }

  /**
   * Changes Layer naming metadata as one reversible edit.
   *
   * @param layer - World member reference or bottom-to-top index.
   * @param name - Replacement name, including an empty string when desired.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   */
  setLayerName(layer: RasterLayer | number, name: string): void {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    this.world.getLayer(layer).name = name;
  }

  /**
   * Changes Layer composition visibility as one reversible edit.
   *
   * @param layer - World member reference or bottom-to-top index.
   * @param visible - Whether the Layer contributes to composition.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   */
  setLayerVisibility(layer: RasterLayer | number, visible: boolean): void {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    this.world.getLayer(layer).visible = visible;
    this.renderer.render();
  }

  /**
   * Changes Layer composition opacity as one reversible edit.
   *
   * @param layer - World member reference or bottom-to-top index.
   * @param opacity - Finite composition opacity in the inclusive range [0, 1].
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   * @throws {ReverieRangeError} Opacity lies outside its supported range.
   */
  setLayerOpacity(layer: RasterLayer | number, opacity: number): void {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    this.world.getLayer(layer).opacity = opacity;
    this.renderer.render();
  }

  /**
   * Changes Layer composition blend mode as one reversible edit.
   *
   * @param layer - World member reference or bottom-to-top index.
   * @param blendMode - Supported composition operation for the Layer.
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   * @throws {ReverieTypeError} The blend mode is unsupported at runtime.
   */
  setLayerBlendMode(
    layer: RasterLayer | number,
    blendMode: LayerBlendMode,
  ): void {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    this.world.getLayer(layer).blendMode = blendMode;
    this.renderer.render();
  }

  /**
   * Removes a document layer, selecting a valid neighbor when necessary.
   * @param layer - Member reference or index; defaults to the active layer.
   * @returns The detached layer with its pixels preserved.
   * @throws {WebError} This facade is disposed or its active target is busy.
   * @throws {ReverieRangeError} The index is invalid or this is the last layer.
   * @throws {ReverieError} The layer is not a member, or removal is in progress.
   */
  removeLayer(layer: RasterLayer | number = this.activeLayer): RasterLayer {
    this.assertUsable();
    this.session.assertCanChangeLayer();
    const removed = this.world.removeLayer(layer);
    this.renderer.render();
    return removed;
  }

  /**
   * Removes every pixel from the active layer and renders the empty canvas.
   *
   * @throws {WebError} This facade is disposed or drawing work has not finished.
   */
  clear(): void {
    this.assertUsable();
    this.session.clearRaster();
  }

  /** Restores the most recent committed document edit. */
  undo(): void {
    this.assertUsable();
    this.session.undo();
  }

  /** Restores the most recently undone document edit. */
  redo(): void {
    this.assertUsable();
    this.session.redo();
  }

  /** Discards all retained Undo and Redo entries without changing the document. */
  clearHistory(): void {
    this.assertUsable();
    this.session.clearHistory();
  }

  /** Begins a non-nested group for related synchronous document mutations. */
  beginHistoryGroup(): void {
    this.assertUsable();
    this.session.beginHistoryGroup();
  }

  /** Commits the active mutation group as one Undo step. */
  commitHistoryGroup(): void {
    this.assertUsable();
    this.session.commitHistoryGroup();
  }

  /** Cancels the active mutation group and restores its prior state. */
  cancelHistoryGroup(): void {
    this.assertUsable();
    this.session.cancelHistoryGroup();
  }

  /**
   * Renders every contributing World layer through the current Camera immediately.
   *
   * @throws {WebError} This facade has been disposed.
   */
  render(): void {
    this.assertUsable();
    this.renderer.render();
  }

  /**
   * Encodes a composed World region and downloads it as an image file.
   *
   * The region defaults to the World's bounds, so a fixed canvas exports its
   * whole surface without extra configuration. An unbounded World has no natural
   * full-image size, so it requires an explicit `region`. Layer order, visibility,
   * and non-destructive opacity are respected independently of the active layer.
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
    const image = await encodeWorldRegion(this.world, region, options);

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

    this.isDisposed = true;
    this.stopObservingLayerRemoval();
    this.session.dispose();
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
