import type { FrameDriver } from "./FrameDriver.js";

/** Optional dependencies and callbacks for cooperative drawing scheduling. */
export interface DrawingSchedulerConfig {
  /** Soft drawing-work budget per frame in milliseconds; defaults to `4`. */
  readonly frameBudget?: number;

  /** Runtime frame primitives; defaults to {@link WebFrameDriver}. */
  readonly frameDriver?: FrameDriver;

  /** Called at most once after a frame executes one or more commands. */
  readonly onRender?: () => void;

  /** Receives an execution or render error after scheduling has stopped. */
  readonly onError?: (error: unknown) => void;
}
