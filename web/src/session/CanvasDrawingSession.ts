import { resolvePaintMode, SelectionMask, Stroke } from "@reverie/core";
import type {
  Brush,
  Camera,
  PaintMode,
  Raster,
  RasterLayer,
  World,
} from "@reverie/core";
import { DocumentHistory } from "@reverie/core/history";
import type { RasterHistoryTransaction } from "@reverie/core/history";
import type { CanvasRenderer } from "@reverie/canvas-renderer";
import type { RenderQualityMode } from "@reverie/core/renderer";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError, WebTypeError } from "../errors/WebErrors.js";
import { resolvePointerStrokeInput } from "../input/ResolvePointerStrokeInput.js";
import type { CanvasDrawingSessionConfig } from "../interfaces/session/CanvasDrawingSessionConfig.js";
import { DrawingScheduler } from "../scheduler/DrawingScheduler.js";

const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Orchestrates responsive canvas sizing and one-pointer Stroke input for Web.
 *
 * The Session owns browser listeners and, when not injected, its scheduler. It
 * never owns the supplied CanvasRenderer, Raster, Camera, or Brush models.
 */
export class CanvasDrawingSession {
  /** Canvas receiving DOM events and responsive backing-buffer dimensions. */
  readonly canvas: HTMLCanvasElement;

  /** Raster receiving every command produced by this Session. */
  private currentRaster: Raster;

  /** Storage receiving newly scheduled commands. */
  get raster(): Raster {
    return this.currentRaster;
  }

  /** Camera converting CSS-pixel input into continuous world positions. */
  readonly camera: Camera;

  /** Optional bounded layer used to execute stamps into {@link raster}. */
  private currentLayer: RasterLayer | undefined;

  /** Bounded layer receiving newly scheduled commands, if configured. */
  get layer(): RasterLayer | undefined {
    return this.currentLayer;
  }

  /** Externally owned renderer used for sizing and presentation. */
  readonly renderer: CanvasRenderer;

  private currentBrush: Brush;
  private currentPaintMode: PaintMode;
  private currentSelection: SelectionMask | null;
  private readonly history: DocumentHistory;
  private readonly scheduler: DrawingScheduler;
  private readonly ownsScheduler: boolean;
  private readonly maxDevicePixelRatio: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onStrokeStart: (() => void) | undefined;
  private readonly onStrokeEnd: (() => void) | undefined;
  private activeStroke: Stroke | null = null;
  private activeStrokeSelection: SelectionMask | null = null;
  private activeStrokeHistoryTransaction: RasterHistoryTransaction | null =
    null;
  private activePointerId: number | null = null;
  /** Caller-visible uint32 identity for the next stroke; independent of frames. */
  private strokeSequence = 0;
  private resizeObserver: ResizeObserver | null = null;
  private runtimeWindow: Window | null = null;
  private isAttached = false;
  private isDisposed = false;
  private isLayerRemovalPending = false;
  private viewQuality: RenderQualityMode = "full";
  private isViewRenderQueued = false;
  private isViewPrefetchActive = false;

  /** Processes pointer-down failures through the Session error boundary. */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.runSafely(() => this.beginStroke(event));
  };

  /** Processes active-pointer movement through the Session error boundary. */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.runSafely(() => this.continueStroke(event));
  };

  /** Ends the matching active pointer and releases its capture. */
  private readonly handlePointerEnd = (event: PointerEvent): void => {
    this.runSafely(() => this.endPointerStroke(event));
  };

  /** Ends a Stroke if its pointer capture disappears outside normal pointerup. */
  private readonly handleLostPointerCapture = (event: PointerEvent): void => {
    this.runSafely(() => {
      if (event.pointerId === this.activePointerId) {
        this.finishActiveStroke(false);
      }
    });
  };

  /** Recalculates the backing buffer when viewport size or DPR may change. */
  private readonly handleResize = (): void => {
    this.runSafely(() => this.resizeAndRender());
  };

  /** Returns the Brush that will be captured by the next Stroke. */
  get brush(): Brush {
    return this.currentBrush;
  }

  /** Returns the operation that will be captured by the next Stroke. */
  get paintMode(): PaintMode {
    return this.currentPaintMode;
  }

  /** Returns the transient Selection captured by the next Stroke. */
  get selection(): SelectionMask | null {
    return this.currentSelection;
  }

  /** Returns whether one pointer currently owns an active Stroke. */
  get isPainting(): boolean {
    return this.activeStroke !== null;
  }

  /** Returns the uint32 sequence to record when saving this drawing session. */
  get nextStrokeSequence(): number {
    return this.strokeSequence;
  }

  /** Returns whether one committed document edit can currently be undone. */
  get canUndo(): boolean {
    return this.history.canUndo;
  }

  /** Returns whether one previously undone document edit can currently be redone. */
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /**
   * Creates an unattached Web drawing Session.
   *
   * @param config - Canvas, models, renderer, brush, and optional runtime hooks.
   * @throws {WebError} The optional layer does not own the supplied Raster.
   * @throws {WebTypeError} The maximum DPR is not a number.
   * @throws {WebRangeError} Maximum DPR or the initial uint32 stroke sequence is invalid.
   */
  constructor(config: CanvasDrawingSessionConfig) {
    const maxDevicePixelRatio =
      config.maxDevicePixelRatio ?? DEFAULT_MAX_DEVICE_PIXEL_RATIO;

    CanvasDrawingSession.assertValidMaxDevicePixelRatio(maxDevicePixelRatio);

    const strokeSequence =
      config.strokeSequence === undefined ? 0 : config.strokeSequence;
    if (
      !Number.isInteger(strokeSequence) ||
      strokeSequence < 0 ||
      strokeSequence > 0xffffffff
    ) {
      throw WebRangeError.from(WebErrorDefinitions.INVALID_STROKE_SEQUENCE);
    }
    this.strokeSequence = strokeSequence >>> 0;

    if (config.layer !== undefined && config.layer.raster !== config.raster) {
      throw WebError.from(WebErrorDefinitions.SESSION_LAYER_RASTER_MISMATCH);
    }
    if (
      config.world !== undefined &&
      config.layer !== undefined &&
      !config.world.layers.includes(config.layer)
    ) {
      throw WebError.from(WebErrorDefinitions.SESSION_WORLD_LAYER_MISMATCH);
    }

    const selection = config.selection ?? null;
    CanvasDrawingSession.assertValidSelection(selection);

    this.canvas = config.canvas;
    this.currentRaster = config.raster;
    this.camera = config.camera;
    this.currentLayer = config.layer;
    this.renderer = config.renderer;
    this.currentBrush = config.brush;
    this.currentPaintMode = resolvePaintMode(config.paintMode);
    this.currentSelection = selection;
    this.history = new DocumentHistory(
      config.world === undefined ? {} : { world: config.world },
    );
    this.maxDevicePixelRatio = maxDevicePixelRatio;
    this.onError = config.onError;
    this.onStrokeStart = config.onStrokeStart;
    this.onStrokeEnd = config.onStrokeEnd;
    this.ownsScheduler = config.scheduler === undefined;
    this.scheduler =
      config.scheduler ??
      new DrawingScheduler({
        ...(config.frameBudget === undefined
          ? {}
          : { frameBudget: config.frameBudget }),
        onRender: (hasNewDrawingCommands, changedTiles) => {
          if (hasNewDrawingCommands) {
            this.renderer.markSourceChanged(changedTiles);
            this.viewQuality = "full";
            this.isViewPrefetchActive = false;
          }
          const hasViewRequest = this.isViewRenderQueued;
          if (hasViewRequest) {
            this.renderer.recordViewRenderExecution();
            this.isViewRenderQueued = false;
          }
          this.renderer.render({
            quality: this.viewQuality,
            prefetch: this.isViewPrefetchActive,
            remainingFrameBudgetMs: this.scheduler.remainingFrameBudgetMs,
          });
          const hasPendingRender = this.renderer.hasPendingRender;
          if (!hasPendingRender) {
            this.isViewPrefetchActive = false;
          }
          return hasPendingRender;
        },
        ...(config.onError === undefined ? {} : { onError: config.onError }),
      });
  }

  /** Schedules frames until the current progressive render has completed. */
  requestRenderContinuation(): void {
    this.viewQuality = "full";
    this.isViewPrefetchActive = false;
    if (this.renderer.hasPendingRender) {
      this.scheduler.requestRender();
    }
  }

  /**
   * Coalesces camera changes and renders the latest view in an animation frame.
   * @param quality - Host-selected policy for this interaction frame.
   * @throws {WebTypeError} The quality is unsupported at runtime.
   */
  requestViewRender(quality: RenderQualityMode): void {
    if (this.isDisposed) {
      return;
    }
    if (quality !== "full" && quality !== "interactive") {
      throw WebTypeError.from(WebErrorDefinitions.INVALID_VIEW_QUALITY);
    }
    this.renderer.recordViewRenderRequest(
      this.isViewRenderQueued || !this.scheduler.idle,
    );
    this.viewQuality = quality;
    this.isViewPrefetchActive = true;
    this.isViewRenderQueued = true;
    this.scheduler.requestRender();
  }

  /**
   * Replaces the Brush used by future Strokes.
   *
   * An active Stroke retains the Brush it captured when it began, including
   * for commands that remain queued in the scheduler.
   *
   * @param brush - Brush to capture when the next Stroke begins.
   */
  setBrush(brush: Brush): void {
    this.currentBrush = brush;
  }

  /**
   * Replaces the operation captured by future Strokes.
   *
   * An active Stroke retains its mode, including commands already queued for it.
   *
   * @param paintMode - Supported operation to capture for the next Stroke.
   * @throws {ReverieTypeError} The supplied operation is unsupported.
   */
  setPaintMode(paintMode: PaintMode): void {
    this.currentPaintMode = resolvePaintMode(paintMode);
  }

  /**
   * Replaces the transient coverage mask captured by future Strokes.
   *
   * The mask reference is captured rather than cloned. Callers must not mutate
   * an installed mask until the active Stroke and queued drawing work finish.
   *
   * @param selection - SelectionMask to apply, or null for unrestricted writes.
   * @throws {WebTypeError} The value is neither a SelectionMask nor null.
   * @throws {WebError} The Session is disposed or drawing work is still active.
   */
  setSelection(selection: SelectionMask | null): void {
    CanvasDrawingSession.assertValidSelection(selection);
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.SELECTION_CHANGE_WHILE_DISPOSED);
    }
    if (this.isPainting || this.scheduler.pendingCommandCount > 0) {
      throw WebError.from(WebErrorDefinitions.SELECTION_CHANGE_WHILE_BUSY);
    }
    this.currentSelection = selection;
  }

  /**
   * Rejects editing-target changes until pointer input and queued work finish.
   * @throws {WebError} The session is disposed, painting, executing work, or in a removal callback.
   */
  assertCanChangeLayer(): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.LAYER_CHANGE_WHILE_DISPOSED);
    }
    if (this.isLayerRemovalPending) {
      throw WebError.from(WebErrorDefinitions.LAYER_CHANGE_DURING_REMOVAL);
    }
    if (this.isPainting || this.scheduler.pendingCommandCount > 0) {
      throw WebError.from(WebErrorDefinitions.LAYER_CHANGE_WHILE_BUSY);
    }
  }

  /**
   * Selects the bounded Raster target for subsequent strokes.
   * @param layer - Layer captured by commands accepted after the change.
   * @throws {WebError} Drawing or queued work has not finished, the session is
   * disposed, or a removal callback is in progress.
   */
  setLayer(layer: RasterLayer): void {
    this.assertCanChangeLayer();
    this.assignLayer(layer);
  }

  /** Restores the most recent committed document edit and renders immediately. */
  undo(): void {
    this.assertCanUseHistory();
    this.history.undo();
    this.renderer.invalidate();
    this.renderer.render();
    this.requestRenderContinuation();
  }

  /** Restores the most recently undone document edit and renders immediately. */
  redo(): void {
    this.assertCanUseHistory();
    this.history.redo();
    this.renderer.invalidate();
    this.renderer.render();
    this.requestRenderContinuation();
  }

  /** Discards retained Undo and Redo entries without changing the document. */
  clearHistory(): void {
    this.assertCanUseHistory();
    this.history.clear();
  }

  /** Begins a non-nested group for related synchronous document mutations. */
  beginHistoryGroup(): void {
    this.assertCanUseHistory();
    this.history.beginGroup();
  }

  /** Commits the active group as one Undo step. */
  commitHistoryGroup(): void {
    this.assertCanUseHistory();
    this.history.commitGroup();
  }

  /** Cancels the active group, restores its prior state, and renders. */
  cancelHistoryGroup(): void {
    this.assertCanUseHistory();
    this.history.cancelGroup();
    this.renderer.invalidate();
    this.renderer.render();
    this.requestRenderContinuation();
  }

  /** Clears the current Raster as one reversible document edit. */
  clearRaster(): void {
    this.assertCanUseHistory();
    this.history.performRasterMutation(this.raster, () => this.raster.clear());
    this.renderer.invalidate();
    this.renderer.render();
    this.requestRenderContinuation();
  }

  /**
   * Reserves this Session's selection while a World removes a layer and repairs
   * the target through an infallible assignment after successful removal.
   * Bind this Session to only one document at a time.
   * @param world - Document whose removals should preserve this Session's target.
   * @param onLayerChange - Non-throwing callback synchronizing the owner's selection.
   * @returns An idempotent unsubscribe function owned by the caller.
   */
  observeLayerRemoval(
    world: World,
    onLayerChange: (layer: RasterLayer) => void,
  ): () => void {
    return world.observeLayerRemoval({
      beforeRemove: (layer) => {
        if (layer === this.currentLayer) {
          this.assertCanChangeLayer();
        }
        this.isLayerRemovalPending = true;
      },
      afterRemove: (layer, index) => {
        if (layer === this.currentLayer) {
          const replacement = world.getLayer(Math.max(0, index - 1));
          // Validation happened before mutation. Disposal in another observer
          // must not make this committed document change fail afterward.
          this.assignLayer(replacement);
          onLayerChange(replacement);
        }
      },
      afterRemovalAttempt: () => {
        this.isLayerRemovalPending = false;
      },
    });
  }

  /** Updates both target references without calling fallible lifecycle guards. */
  private assignLayer(layer: RasterLayer): void {
    this.currentLayer = layer;
    this.currentRaster = layer.raster;
  }

  /**
   * Registers browser input and resize resources and renders the initial frame.
   *
   * Repeated calls while attached are no-ops.
   *
   * @throws {WebError} The Session was disposed or ResizeObserver is unavailable
   * and no `onError` callback handles the failure.
   */
  attach(): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.SESSION_DISPOSED);
    }

    if (this.isAttached) {
      return;
    }

    try {
      const runtimeWindow = this.canvas.ownerDocument.defaultView;
      const ResizeObserverConstructor = runtimeWindow?.ResizeObserver;

      if (runtimeWindow === null || ResizeObserverConstructor === undefined) {
        throw WebError.from(WebErrorDefinitions.RESIZE_OBSERVER_UNAVAILABLE);
      }

      this.runtimeWindow = runtimeWindow;
      this.resizeObserver = new ResizeObserverConstructor(this.handleResize);
      this.addRuntimeListeners(runtimeWindow);
      this.resizeObserver.observe(this.canvas);
      this.isAttached = true;
      this.resizeAndRender();
    } catch (error) {
      this.removeRuntimeResources();
      this.reportError(error);
    }
  }

  /**
   * Removes browser resources, ends active input, and closes owned scheduling.
   *
   * Repeated calls are safe. Injected schedulers and all model dependencies
   * remain externally owned and are not disposed. The Session is closed before
   * fallible teardown, and every teardown stage is attempted.
   * @throws A single teardown failure unchanged, or `AggregateError` preserving
   * multiple failures from user callbacks and runtime resource cleanup.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    // Attempt every teardown even when user callbacks or an injected runtime
    // throw. Preserve a single original failure; aggregate simultaneous failures.
    const failures: unknown[] = [];
    for (const teardown of [
      () => this.cancelActiveStroke(true),
      () => this.removeRuntimeResources(),
      () => {
        if (this.ownsScheduler) {
          this.scheduler.dispose();
        }
      },
      () => this.history.dispose(),
    ]) {
      try {
        teardown();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "CanvasDrawingSession teardown failed.",
      );
    }
  }

  /** Registers all listener identities owned by this Session. */
  private addRuntimeListeners(runtimeWindow: Window): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerEnd);
    this.canvas.addEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.addEventListener(
      "lostpointercapture",
      this.handleLostPointerCapture,
    );
    runtimeWindow.addEventListener("resize", this.handleResize);
  }

  /** Removes every listener and observer that may have been partially created. */
  private removeRuntimeResources(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerEnd);
    this.canvas.removeEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.removeEventListener(
      "lostpointercapture",
      this.handleLostPointerCapture,
    );
    this.runtimeWindow?.removeEventListener("resize", this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.runtimeWindow = null;
    this.isAttached = false;
  }

  /** Starts one primary-button Stroke and captures its initiating pointer. */
  private beginStroke(event: PointerEvent): void {
    if (
      this.isDisposed ||
      this.isLayerRemovalPending ||
      event.button !== 0 ||
      this.activePointerId !== null
    ) {
      return;
    }

    const stroke = new Stroke({
      brush: this.currentBrush,
      paintMode: this.currentPaintMode,
      strokeSequence: this.strokeSequence,
    });
    const transaction = this.history.beginRasterTransaction(this.raster);
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.activeStroke = stroke;
    this.activeStrokeSelection = this.currentSelection;
    this.activeStrokeHistoryTransaction = transaction;
    this.canvas.setPointerCapture(event.pointerId);
    this.strokeSequence = (this.strokeSequence + 1) >>> 0;
    this.onStrokeStart?.();
    this.addPointerSamples(event);
  }

  /** Adds coalesced input only for the pointer that owns the active Stroke. */
  private continueStroke(event: PointerEvent): void {
    if (
      event.pointerId !== this.activePointerId ||
      this.activeStroke === null
    ) {
      return;
    }

    event.preventDefault();
    this.addPointerSamples(event);
  }

  /** Ends pointerup or pointercancel input and releases capture when retained. */
  private endPointerStroke(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    event.preventDefault();
    this.finishActiveStroke(true);
  }

  /**
   * Converts all represented CSS-pixel samples, resolves their normalized input
   * attributes, and drains the generated commands.
   */
  private addPointerSamples(event: PointerEvent): void {
    const stroke = this.activeStroke;

    if (stroke === null) {
      return;
    }

    const bounds = this.canvas.getBoundingClientRect();
    const coalescedEvents = event.getCoalescedEvents?.() ?? [];
    const pointerEvents =
      coalescedEvents.length > 0 ? coalescedEvents : [event];

    for (const pointerEvent of pointerEvents) {
      const strokeInput = resolvePointerStrokeInput(pointerEvent);

      stroke.addSample({
        position: this.camera.screenToWorld({
          x: pointerEvent.clientX - bounds.left,
          y: pointerEvent.clientY - bounds.top,
        }),
        timestamp: pointerEvent.timeStamp,
        pressure: strokeInput.pressure,
        tiltX: strokeInput.tiltX,
        tiltY: strokeInput.tiltY,
      });
    }

    while (stroke.hasPendingStamps) {
      const stamp = stroke.nextStamp();

      if (stamp === undefined) {
        break;
      }

      const transaction = this.activeStrokeHistoryTransaction;
      if (transaction === null) {
        throw new Error("Active Stroke is missing its History transaction.");
      }
      transaction.scheduleMutation();
      this.scheduler.enqueue({
        stamp,
        brush: stroke.brush,
        raster: this.raster,
        historyTransaction: transaction,
        ...(this.layer === undefined ? {} : { layer: this.layer }),
        ...(this.activeStrokeSelection === null
          ? {}
          : { selection: this.activeStrokeSelection }),
      });
    }
  }

  /** Ends and clears active Stroke state before capture loss can re-enter. */
  private finishActiveStroke(shouldReleaseCapture: boolean): void {
    const pointerId = this.activePointerId;
    const stroke = this.activeStroke;
    const transaction = this.activeStrokeHistoryTransaction;

    if (stroke === null || pointerId === null || transaction === null) {
      return;
    }

    stroke.end();
    transaction.close();
    this.activeStroke = null;
    this.activeStrokeSelection = null;
    this.activeStrokeHistoryTransaction = null;
    this.activePointerId = null;

    if (shouldReleaseCapture && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }

    this.onStrokeEnd?.();
  }

  /** Cancels active input, restores executed writes, and releases capture. */
  private cancelActiveStroke(shouldReleaseCapture: boolean): void {
    const pointerId = this.activePointerId;
    const stroke = this.activeStroke;
    const transaction = this.activeStrokeHistoryTransaction;
    if (stroke === null || pointerId === null || transaction === null) {
      return;
    }
    stroke.end();
    transaction.cancel();
    this.activeStroke = null;
    this.activeStrokeSelection = null;
    this.activeStrokeHistoryTransaction = null;
    this.activePointerId = null;
    if (shouldReleaseCapture && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.onStrokeEnd?.();
  }

  /** Sizes backing pixels from CSS layout and capped device pixel ratio. */
  private resizeAndRender(): void {
    const runtimeWindow = this.runtimeWindow;

    if (runtimeWindow === null) {
      return;
    }

    const bounds = this.canvas.getBoundingClientRect();
    const devicePixelRatio =
      Number.isFinite(runtimeWindow.devicePixelRatio) &&
      runtimeWindow.devicePixelRatio > 0
        ? runtimeWindow.devicePixelRatio
        : 1;
    const effectiveDpr = Math.min(devicePixelRatio, this.maxDevicePixelRatio);
    const width = Math.max(0, Math.round(bounds.width * effectiveDpr));
    const height = Math.max(0, Math.round(bounds.height * effectiveDpr));

    this.renderer.resize(width, height, effectiveDpr);
    this.renderer.invalidate();
    this.renderer.render();
    this.requestRenderContinuation();
  }

  /** Runs one DOM callback without coupling failures to a UI framework. */
  private runSafely(operation: () => void): void {
    if (this.isDisposed) {
      return;
    }
    try {
      operation();
    } catch (error) {
      this.cancelActiveStroke(true);
      this.reportError(error);
    }
  }

  /** Reports a runtime failure or preserves native uncaught behavior. */
  private reportError(error: unknown): void {
    if (this.onError === undefined) {
      throw error;
    }

    this.onError(error);
  }

  /** Rejects History changes until the Session is idle and outside removal. */
  private assertCanUseHistory(): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.HISTORY_CHANGE_WHILE_DISPOSED);
    }
    if (this.isLayerRemovalPending) {
      throw WebError.from(WebErrorDefinitions.HISTORY_CHANGE_DURING_REMOVAL);
    }
    if (this.isPainting || this.scheduler.pendingCommandCount > 0) {
      throw WebError.from(WebErrorDefinitions.HISTORY_CHANGE_WHILE_BUSY);
    }
  }

  /** Validates the Session-specific DPR cap at its public boundary. */
  private static assertValidMaxDevicePixelRatio(
    value: unknown,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw WebTypeError.from(
        WebErrorDefinitions.INVALID_MAX_DEVICE_PIXEL_RATIO_TYPE,
        { received: typeof value },
      );
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw WebRangeError.from(
        WebErrorDefinitions.INVALID_MAX_DEVICE_PIXEL_RATIO,
      );
    }
  }

  /** Rejects malformed Selection references at Web public boundaries. */
  private static assertValidSelection(
    selection: unknown,
  ): asserts selection is SelectionMask | null {
    if (selection !== null && !(selection instanceof SelectionMask)) {
      throw WebTypeError.from(WebErrorDefinitions.INVALID_SELECTION);
    }
  }
}
