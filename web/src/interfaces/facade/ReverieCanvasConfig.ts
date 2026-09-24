import type { Brush, PaintMode, SelectionMask, World } from "@reverie/core";
import type { CanvasRendererConfig } from "@reverie/canvas-renderer";

/** Configuration for a complete browser drawing surface. */
export interface ReverieCanvasConfig {
  /** Canvas receiving pointer input and rendered pixels. */
  readonly canvas: HTMLCanvasElement;

  /** Existing World to attach without changing its document state. */
  readonly world?: World;

  /** Positive fixed World width; must be supplied together with `height`. */
  readonly width?: number;

  /** Positive fixed World height; must be supplied together with `width`. */
  readonly height?: number;

  /** Positive safe-integer tile edge length forwarded to the World. */
  readonly tileSize?: number;

  /** Initial Brush; defaults to an opaque one-pixel black CircleBrush. */
  readonly brush?: Brush;

  /** Initial operation captured by new strokes. Defaults to paint. */
  readonly paintMode?: PaintMode;

  /** Initial transient Selection, or null for unrestricted writes. */
  readonly selection?: SelectionMask | null;

  /** Initial uint32 stroke sequence for restoring the drawing session. Defaults to `0`. */
  readonly strokeSequence?: number;

  /** Soft scheduler work budget per animation frame, in milliseconds. */
  readonly frameBudget?: number;

  /** Maximum backing pixels per CSS pixel; defaults to `2`. */
  readonly maxDevicePixelRatio?: number;

  /** Optional renderer timing diagnostics; counters remain available by default. */
  readonly diagnostics?: CanvasRendererConfig["diagnostics"];

  /** Receives pointer, resize, scheduling, or rendering failures. */
  readonly onError?: (error: unknown) => void;

  /** Called after a primary pointer successfully begins a Stroke. */
  readonly onStrokeStart?: () => void;

  /** Called after an active Stroke ends for any pointer-lifecycle reason. */
  readonly onStrokeEnd?: () => void;
}
