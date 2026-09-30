import type {
  Brush,
  ViewBinding,
  PaintMode,
  Raster,
  RasterLayer,
  SelectionMask,
  World,
} from "@reveriejs/core";
import type { CanvasRenderer } from "@reveriejs/canvas-renderer";

import type { DrawingScheduler } from "../../scheduler/DrawingScheduler.js";

/** Dependencies and callbacks for browser drawing orchestration. */
interface CanvasDrawingSessionDependencies {
  /** Canvas receiving pointer input and rendered backing pixels. */
  readonly canvas: HTMLCanvasElement;

  /** Sparse Raster that receives scheduled brush stamps. */
  readonly raster: Raster;

  /** Optional bounded layer owning `raster` and mediating Brush writes. */
  readonly layer?: RasterLayer;

  /** Optional World whose Layer mutations share this Session's History. */
  readonly world?: World;

  /** Canvas renderer observing the supplied Raster and Camera. */
  readonly renderer: CanvasRenderer;

  /** Brush captured when each new Stroke begins. */
  readonly brush: Brush;

  /** Initial operation captured by new strokes. Defaults to paint. */
  readonly paintMode?: PaintMode;

  /** Initial transient Selection, or null for unrestricted writes. */
  readonly selection?: SelectionMask | null;

  /** Initial uint32 stroke sequence for restoring session state. Defaults to `0`. */
  readonly strokeSequence?: number;

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

/** Drawing dependencies with exactly one shared projection. */
export type CanvasDrawingSessionConfig = CanvasDrawingSessionDependencies &
  ViewBinding;
