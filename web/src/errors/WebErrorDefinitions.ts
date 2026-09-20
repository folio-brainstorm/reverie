import type { ErrorDefinition } from "@reverie/core";

/** Web-owned message templates paired with stable Web error codes. */
export const WebErrorDefinitions = {
  LAYER_CHANGE_WHILE_DISPOSED: {
    code: "EC_WEB_0022",
    template:
      "Cannot change the drawing layer of a disposed CanvasDrawingSession.",
  },
  LAYER_CHANGE_DURING_REMOVAL: {
    code: "EC_WEB_0023",
    template:
      "Cannot change the drawing layer during a World layer-removal callback.",
  },
  SELECTION_CHANGE_WHILE_DISPOSED: {
    code: "EC_WEB_0024",
    template: "Cannot change the Selection of a disposed CanvasDrawingSession.",
  },
  SELECTION_CHANGE_WHILE_BUSY: {
    code: "EC_WEB_0025",
    template:
      "Finish the active stroke and wait for queued drawing work before changing the Selection.",
  },
  INVALID_SELECTION: {
    code: "EC_WEB_0026",
    template: "CanvasDrawingSession Selection must be a SelectionMask or null.",
  },
  HISTORY_CHANGE_WHILE_DISPOSED: {
    code: "EC_WEB_0027",
    template: "Cannot use History after CanvasDrawingSession is disposed.",
  },
  HISTORY_CHANGE_WHILE_BUSY: {
    code: "EC_WEB_0028",
    template:
      "Finish the active stroke and wait for queued drawing work before using History.",
  },
  HISTORY_CHANGE_DURING_REMOVAL: {
    code: "EC_WEB_0029",
    template: "Cannot use History during a World layer-removal callback.",
  },
  SESSION_WORLD_LAYER_MISMATCH: {
    code: "EC_WEB_0030",
    template:
      "CanvasDrawingSession layer must belong to the supplied History World.",
  },
  LAYER_CHANGE_WHILE_BUSY: {
    code: "EC_WEB_0021",
    template:
      "Finish the active stroke and wait for queued drawing work before changing or removing its layer.",
  },
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
  INVALID_ENCODED_IMAGE: {
    code: "EC_WEB_0013",
    template:
      "Encoded image must be an object with a `Uint8Array` `data` buffer, a `mimeType`, and an `extension`.",
  },
  INVALID_ENCODED_IMAGE_DATA: {
    code: "EC_WEB_0014",
    template:
      "Encoded image `data` must be a Uint8Array, but received `$received`.",
  },
  EMPTY_ENCODED_IMAGE_DATA: {
    code: "EC_WEB_0015",
    template: "Encoded image `data` must contain at least one byte.",
  },
  INVALID_ENCODED_IMAGE_FIELD: {
    code: "EC_WEB_0016",
    template:
      "Encoded image `$param` must be a non-empty string, but received `$received`.",
  },
  INVALID_DOWNLOAD_FILENAME: {
    code: "EC_WEB_0017",
    template:
      "Download filename must be a non-empty string, but received `$received`.",
  },
  EXPORT_REGION_REQUIRED: {
    code: "EC_WEB_0018",
    template: "An export region is required when exporting an unbounded World.",
  },
  UNSUPPORTED_EXPORT_FORMAT: {
    code: "EC_WEB_0019",
    template: "Unsupported export format `$received`.",
  },
  INVALID_STROKE_SEQUENCE: {
    code: "EC_WEB_0020",
    template:
      "CanvasDrawingSession strokeSequence must be an integer between 0 and 4294967295.",
  },
} as const satisfies Record<string, ErrorDefinition>;
