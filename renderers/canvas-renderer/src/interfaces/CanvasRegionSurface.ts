import type { WorldRect } from "@reverie/core";

/** Reusable Canvas upload resources for one final-pixel render region. */
export interface CanvasRegionSurface {
  /** World-space bounds used to prune surfaces outside the retention boundary. */
  readonly bounds: WorldRect;

  /** Offscreen Canvas containing the most recently uploaded region pixels. */
  readonly canvas: HTMLCanvasElement;

  /** Context used to create and upload the region ImageData. */
  readonly context: CanvasRenderingContext2D;

  /** Reusable RGBA8 storage accepted by the Canvas API. */
  readonly imageData: ImageData;

  /** Published immutable pixel buffer last verified against this surface. */
  lastValidatedPixels?: Uint8Array;
}
