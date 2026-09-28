import type { TileCoord } from "@reveriejs/core/rendering";

import type { FrameDriver } from "./FrameDriver.js";

/** Optional dependencies and callbacks for cooperative drawing scheduling. */
export interface DrawingSchedulerConfig {
  /** Soft drawing-work budget per frame in milliseconds; defaults to `4`. */
  readonly frameBudget?: number;

  /** Runtime frame primitives; defaults to {@link WebFrameDriver}. */
  readonly frameDriver?: FrameDriver;

  /**
   * Called after drawing work or while a prior render requests another batch.
   * @param hasNewDrawingCommands - Whether this frame executed one or more
   * drawing commands that changed the document since the previous presentation.
   * @param changedTiles - Conservative Tile coordinates touched by those commands.
   * Return `true` to request one more frame for progressive presentation.
   */
  readonly onRender?: (
    hasNewDrawingCommands: boolean,
    changedTiles?: readonly TileCoord[],
  ) => boolean | void;

  /** Receives an execution or render error after scheduling has stopped. */
  readonly onError?: (error: unknown) => void;
}
