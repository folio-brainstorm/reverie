import { Stroke } from "@reverie/core";
import type { Brush, Camera, Raster, RasterLayer } from "@reverie/core";
import type { CanvasRenderer } from "@reverie/renderer";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError, WebTypeError } from "../errors/WebErrors.js";
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
  readonly raster: Raster;

  /** Camera converting CSS-pixel input into continuous world positions. */
  readonly camera: Camera;

  /** Optional bounded layer used to execute stamps into {@link raster}. */
  readonly layer: RasterLayer | undefined;

  /** Externally owned renderer used for sizing and presentation. */
  readonly renderer: CanvasRenderer;

  private currentBrush: Brush;
  private readonly scheduler: DrawingScheduler;
  private readonly ownsScheduler: boolean;
  private readonly maxDevicePixelRatio: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onStrokeStart: (() => void) | undefined;
  private readonly onStrokeEnd: (() => void) | undefined;
  private activeStroke: Stroke | null = null;
  private activePointerId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private runtimeWindow: Window | null = null;
  private isAttached = false;
  private isDisposed = false;

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

  /** Returns whether one pointer currently owns an active Stroke. */
  get isPainting(): boolean {
    return this.activeStroke !== null;
  }

  /**
   * Creates an unattached Web drawing Session.
   *
   * @param config - Canvas, models, renderer, brush, and optional runtime hooks.
   * @throws {WebError} The optional layer does not own the supplied Raster.
   * @throws {WebTypeError} The maximum DPR is not a number.
   * @throws {WebRangeError} The maximum DPR is not positive and finite.
   */
  constructor(config: CanvasDrawingSessionConfig) {
    const maxDevicePixelRatio =
      config.maxDevicePixelRatio ?? DEFAULT_MAX_DEVICE_PIXEL_RATIO;

    CanvasDrawingSession.assertValidMaxDevicePixelRatio(maxDevicePixelRatio);

    if (config.layer !== undefined && config.layer.raster !== config.raster) {
      throw WebError.from(WebErrorDefinitions.SESSION_LAYER_RASTER_MISMATCH);
    }

    this.canvas = config.canvas;
    this.raster = config.raster;
    this.camera = config.camera;
    this.layer = config.layer;
    this.renderer = config.renderer;
    this.currentBrush = config.brush;
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
        onRender: () => this.renderer.render(),
        ...(config.onError === undefined ? {} : { onError: config.onError }),
      });
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
   * Registers browser input and resize resources and renders the initial frame.
   *
   * Repeated calls while attached are no-ops.
   *
   * @throws {WebError} The Session was disposed or ResizeObserver is unavailable
   * and no `onError` callback handles the failure.
   */
  attach(): void {
    if (this.isAttached) {
      return;
    }

    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.SESSION_DISPOSED);
    }

    try {
      const runtimeWindow = this.canvas.ownerDocument.defaultView;
      const ResizeObserverConstructor = runtimeWindow?.ResizeObserver;

      if (runtimeWindow === null || ResizeObserverConstructor === undefined) {
        throw WebError.from(
          WebErrorDefinitions.RESIZE_OBSERVER_UNAVAILABLE,
        );
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
   * remain externally owned and are not disposed.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.finishActiveStroke(true);
    this.removeRuntimeResources();

    if (this.ownsScheduler) {
      this.scheduler.dispose();
    }

    this.isDisposed = true;
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
    if (event.button !== 0 || this.activePointerId !== null) {
      return;
    }

    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.activePointerId = event.pointerId;
    this.activeStroke = new Stroke({ brush: this.currentBrush });
    this.onStrokeStart?.();
    this.addPointerSamples(event);
  }

  /** Adds coalesced input only for the pointer that owns the active Stroke. */
  private continueStroke(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId || this.activeStroke === null) {
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

  /** Converts all represented CSS-pixel samples and drains generated commands. */
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
      stroke.addSample({
        position: this.camera.screenToWorld({
          x: pointerEvent.clientX - bounds.left,
          y: pointerEvent.clientY - bounds.top,
        }),
        timestamp: pointerEvent.timeStamp,
      });
    }

    while (stroke.hasPendingStamps) {
      const stamp = stroke.nextStamp();

      if (stamp === undefined) {
        break;
      }

      this.scheduler.enqueue({
        stamp,
        brush: stroke.brush,
        raster: this.raster,
        ...(this.layer === undefined ? {} : { layer: this.layer }),
      });
    }
  }

  /** Ends and clears active Stroke state before capture loss can re-enter. */
  private finishActiveStroke(shouldReleaseCapture: boolean): void {
    const pointerId = this.activePointerId;
    const stroke = this.activeStroke;

    if (stroke === null || pointerId === null) {
      return;
    }

    stroke.end();
    this.activeStroke = null;
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
    const effectiveDpr = Math.min(
      devicePixelRatio,
      this.maxDevicePixelRatio,
    );
    const width = Math.max(0, Math.round(bounds.width * effectiveDpr));
    const height = Math.max(0, Math.round(bounds.height * effectiveDpr));

    this.renderer.resize(width, height, effectiveDpr);
    this.renderer.render();
  }

  /** Runs one DOM callback without coupling failures to a UI framework. */
  private runSafely(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.activeStroke?.end();
      this.activeStroke = null;
      this.activePointerId = null;
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
}
