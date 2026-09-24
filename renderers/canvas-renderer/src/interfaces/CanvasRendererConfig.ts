import type { Camera } from "@reverie/core";
import type { RenderSource } from "@reverie/core/renderer";

/** Dependencies used by a canvas renderer for every explicit render pass. */
interface CanvasRendererDependencies {
  /** Canvas whose backing buffer receives the rendered raster. */
  canvas: HTMLCanvasElement;

  /** Camera that projects world coordinates into screen coordinates. */
  camera: Camera;

  /** Enables optional stage timing and 60-call rolling statistics. */
  readonly diagnostics?: { readonly timings?: boolean };
}

/** Exactly one rendering source: an independent Raster or a composed World. */
export type CanvasRendererConfig = CanvasRendererDependencies & RenderSource;
