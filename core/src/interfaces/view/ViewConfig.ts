import type { CameraConfig } from "../camera/CameraConfig.js";

/** Initial renderer-independent projection state. */
export interface ViewConfig extends CameraConfig {
  /** Finite clockwise angle in radians; defaults to zero. */
  rotation?: number;
}
