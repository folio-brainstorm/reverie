import type { Brush } from "@reverie/core";

/** Configuration for a complete browser drawing surface. */
export interface ReverieCanvasConfig {
  /** Canvas receiving pointer input and rendered pixels. */
  readonly canvas: HTMLCanvasElement;

  /** Positive fixed World width; must be supplied together with `height`. */
  readonly width?: number;

  /** Positive fixed World height; must be supplied together with `width`. */
  readonly height?: number;

  /** Positive safe-integer tile edge length forwarded to the World. */
  readonly tileSize?: number;

  /** Initial Brush; defaults to an opaque one-pixel black CircleBrush. */
  readonly brush?: Brush;

  /** Soft scheduler work budget per animation frame, in milliseconds. */
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
