import type { ErrorDefinition } from "@reverie/core";

/** Web-owned message templates paired with stable Web error codes. */
export const WebErrorDefinitions = {
  INVALID_FRAME_BUDGET_TYPE: {
    code: "EC_WEB_0001",
    template:
      "DrawingScheduler frame budget must be a number, but received `$received`.",
  },
  INVALID_FRAME_BUDGET: {
    code: "EC_WEB_0002",
    template:
      "DrawingScheduler frame budget must be a positive finite number of milliseconds.",
  },
  FRAME_SCHEDULING_UNAVAILABLE: {
    code: "EC_WEB_0003",
    template:
      "Animation frame scheduling and high-resolution timing are not available in the current runtime.",
  },
  SCHEDULER_DISPOSED: {
    code: "EC_WEB_0004",
    template: "Cannot enqueue work into a disposed DrawingScheduler.",
  },
  SCHEDULER_FAILED: {
    code: "EC_WEB_0005",
    template: "Cannot enqueue work into a failed DrawingScheduler.",
  },
  INVALID_MAX_DEVICE_PIXEL_RATIO_TYPE: {
    code: "EC_WEB_0006",
    template:
      "CanvasDrawingSession maximum device pixel ratio must be a number, but received `$received`.",
  },
  INVALID_MAX_DEVICE_PIXEL_RATIO: {
    code: "EC_WEB_0007",
    template:
      "CanvasDrawingSession maximum device pixel ratio must be positive and finite.",
  },
  RESIZE_OBSERVER_UNAVAILABLE: {
    code: "EC_WEB_0008",
    template:
      "ResizeObserver is required to attach a CanvasDrawingSession in this runtime.",
  },
  SESSION_DISPOSED: {
    code: "EC_WEB_0009",
    template: "Cannot attach a disposed CanvasDrawingSession.",
  },
  SESSION_LAYER_RASTER_MISMATCH: {
    code: "EC_WEB_0010",
    template:
      "CanvasDrawingSession layer must own the Raster supplied to the Session.",
  },
  INVALID_REVERIE_CANVAS_DIMENSIONS: {
    code: "EC_WEB_0011",
    template:
      "ReverieCanvas width and height must either both be omitted or both be positive safe integers.",
  },
  REVERIE_CANVAS_DISPOSED: {
    code: "EC_WEB_0012",
    template: "ReverieCanvas has been disposed.",
  },
} as const satisfies Record<string, ErrorDefinition>;
