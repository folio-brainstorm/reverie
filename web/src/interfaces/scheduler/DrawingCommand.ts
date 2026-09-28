import type {
  Brush,
  Raster,
  RasterLayer,
  SelectionMask,
  StampCommand,
} from "@reveriejs/core";
import type { RasterHistoryTransaction } from "@reveriejs/core/history";

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

  /** Selection reference captured for this command, or null for unrestricted writes. */
  readonly selection?: SelectionMask | null;

  /** Optional Stroke transaction spanning every command in the same edit. */
  readonly historyTransaction?: RasterHistoryTransaction;
}
