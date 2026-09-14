import type { Raster } from "@reverie/core";

/** Dependencies used by an export renderer for every explicit export pass. */
export interface ExportRendererConfig {
  /** Sparse raster read by the exporter without mutation. */
  raster: Raster;
}
