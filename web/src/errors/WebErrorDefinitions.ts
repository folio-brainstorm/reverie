import type { ErrorDefinition } from "@reverie/core";

/** Stable codes for failures emitted by Web runtime infrastructure. */
export const WebErrorCodes = Object.freeze({
  INVALID_FRAME_BUDGET_TYPE: "EC_WEB_0001",
  INVALID_FRAME_BUDGET: "EC_WEB_0002",
  FRAME_SCHEDULING_UNAVAILABLE: "EC_WEB_0003",
  SCHEDULER_DISPOSED: "EC_WEB_0004",
  SCHEDULER_FAILED: "EC_WEB_0005",
  INVALID_MAX_DEVICE_PIXEL_RATIO_TYPE: "EC_WEB_0006",
  INVALID_MAX_DEVICE_PIXEL_RATIO: "EC_WEB_0007",
  RESIZE_OBSERVER_UNAVAILABLE: "EC_WEB_0008",
  SESSION_DISPOSED: "EC_WEB_0009",
} as const);

/** Web-owned message templates paired with stable Web error codes. */
export const WebErrorDefinitions = Object.freeze({
  INVALID_FRAME_BUDGET_TYPE: {
    code: WebErrorCodes.INVALID_FRAME_BUDGET_TYPE,
    template:
      "DrawingScheduler frame budget must be a number, but received `$received`.",
  },
  INVALID_FRAME_BUDGET: {
    code: WebErrorCodes.INVALID_FRAME_BUDGET,
    template:
      "DrawingScheduler frame budget must be a positive finite number of milliseconds.",
  },
  FRAME_SCHEDULING_UNAVAILABLE: {
    code: WebErrorCodes.FRAME_SCHEDULING_UNAVAILABLE,
    template:
      "Animation frame scheduling and high-resolution timing are not available in the current runtime.",
  },
  SCHEDULER_DISPOSED: {
    code: WebErrorCodes.SCHEDULER_DISPOSED,
    template: "Cannot enqueue work into a disposed DrawingScheduler.",
  },
  SCHEDULER_FAILED: {
    code: WebErrorCodes.SCHEDULER_FAILED,
    template: "Cannot enqueue work into a failed DrawingScheduler.",
  },
  INVALID_MAX_DEVICE_PIXEL_RATIO_TYPE: {
    code: WebErrorCodes.INVALID_MAX_DEVICE_PIXEL_RATIO_TYPE,
    template:
      "CanvasDrawingSession maximum device pixel ratio must be a number, but received `$received`.",
  },
  INVALID_MAX_DEVICE_PIXEL_RATIO: {
    code: WebErrorCodes.INVALID_MAX_DEVICE_PIXEL_RATIO,
    template:
      "CanvasDrawingSession maximum device pixel ratio must be positive and finite.",
  },
  RESIZE_OBSERVER_UNAVAILABLE: {
    code: WebErrorCodes.RESIZE_OBSERVER_UNAVAILABLE,
    template:
      "ResizeObserver is required to attach a CanvasDrawingSession in this runtime.",
  },
  SESSION_DISPOSED: {
    code: WebErrorCodes.SESSION_DISPOSED,
    template: "Cannot attach a disposed CanvasDrawingSession.",
  },
} as const satisfies Record<string, ErrorDefinition>);
