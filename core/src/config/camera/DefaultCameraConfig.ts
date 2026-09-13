import type { CameraConfig } from "../../interfaces/camera/CameraConfig.js";

export const DEFAULT_CAMERA_PAN_X = 0;
export const DEFAULT_CAMERA_PAN_Y = 0;
export const DEFAULT_CAMERA_ZOOM = 1;

export const defaultCameraConfig: Readonly<Required<CameraConfig>> =
  Object.freeze({
    panX: DEFAULT_CAMERA_PAN_X,
    panY: DEFAULT_CAMERA_PAN_Y,
    zoom: DEFAULT_CAMERA_ZOOM,
  });
