import type { ViewConfig } from "../../interfaces/view/ViewConfig.js";

import { View } from "../view/View.js";
import { defaultCameraConfig } from "../../config/camera/DefaultCameraConfig.js";

/** Compatibility entry point for View, preserving legacy Camera error codes. */
export class Camera extends View {
  /** Creates a compatible projection with legacy pan and zoom defaults.
   * @param config - Optional pan, zoom and clockwise rotation in radians.
   * @throws {ReverieTypeError} An initial value is not a number.
   * @throws {ReverieRangeError} An initial value is non-finite or zoom is not positive.
   */
  constructor(config: ViewConfig = {}) {
    super();
    this.useCameraErrors();
    this.setPan(
      config.panX === undefined ? defaultCameraConfig.panX : config.panX,
      config.panY === undefined ? defaultCameraConfig.panY : config.panY,
    );
    this.setZoom(
      config.zoom === undefined ? defaultCameraConfig.zoom : config.zoom,
    );
    this.setRotation(config.rotation === undefined ? 0 : config.rotation);
  }
}
