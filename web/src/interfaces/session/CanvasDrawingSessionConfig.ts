import type { Brush, Camera, Raster, RasterLayer } from "@reverie/core";
import type { CanvasRenderer } from "@reverie/renderer";

import type { DrawingScheduler } from "../../scheduler/DrawingScheduler.js";

/** Dependencies and callbacks for browser drawing orchestration. */
export interface CanvasDrawingSessionConfig {
  /** Canvas receiving pointer input and rendered backing pixels. */
  readonly canvas: HTMLCanvasElement;

  /** Sparse Raster that receives scheduled brush stamps. */
  readonly raster: Raster;

  /** Optional bounded layer owning `raster` and mediating Brush writes. */
  readonly layer?: RasterLayer;

  /** Camera whose zoom remains CSS pixels per world unit. */
  readonly camera: Camera;

  /** Canvas renderer observing the supplied Raster and Camera. */
  readonly renderer: CanvasRenderer;

  /** Brush captured when each new Stroke begins. */
  readonly brush: Brush;

  /** Optional externally owned command scheduler. */
  readonly scheduler?: DrawingScheduler;

  /** Soft frame budget used only when the Session creates its scheduler. */
  readonly frameBudget?: number;

  /** Maximum backing pixels per CSS pixel; defaults to `2`. */
  readonly maxDevicePixelRatio?: number;

  /** Receives pointer, resize, scheduling, or rendering failures. */
  readonly onError?: (error: unknown) => void;

  /** Called after a primary pointer successfully begins a Stroke. */
  readonly onStrokeStart?: () => void;

  /** Called after an active Stroke ends for any pointer-lifecycle reason. */
  readonly onStrokeEnd?: () => void;
}
