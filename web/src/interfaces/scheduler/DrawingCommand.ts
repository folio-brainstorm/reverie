import type {
  Brush,
  Raster,
  RasterLayer,
  StampCommand,
} from "@reverie/core";

/** Supplies the runtime objects needed to execute one core stamp command. */
export interface DrawingCommand {
  /** World-space stamp intent produced by the core stroke pipeline. */
  readonly stamp: StampCommand;

  /** Stable brush instance used to execute this command. */
  readonly brush: Brush;

  /** Raster that receives the executed stamp. */
  readonly raster: Raster;

  /** Optional bounded layer that mediates final pixel writes. */
  readonly layer?: RasterLayer;
}
