import type { Camera, Raster } from "@reverie/core";

/** Dependencies used by a canvas renderer for every explicit render pass. */
export interface CanvasRendererConfig {
  /** Canvas whose backing buffer receives the rendered raster. */
  canvas: HTMLCanvasElement;

  /** Sparse raster read by the renderer without mutation. */
  raster: Raster;

  /** Camera that projects world coordinates into screen coordinates. */
  camera: Camera;
}
