import type { ErrorDefinition } from "../../interfaces/errors/ErrorDefinition.js";
import { deriveDefinitionCodes } from "../definitions/DeriveDefinitionCodes.js";

/**
 * Internal error definitions. Message text may evolve; error codes must not be
 * renamed, reassigned, or reused after publication.
 */
export const ErrorDefinitions = {
  COMMON: {
    INVALID_COORDINATE_TYPE: {
      code: "EC_COMMON_0001",
      template:
        "Invalid type for `$param`: expected `$expected`, but received: `$received`.",
    },
    UNSAFE_COORDINATE_VALUE: {
      code: "EC_COMMON_0002",
      template:
        "Unsafe coordinate value: { x: `$x`, y: `$y` }. Coordinates must be safe integers.",
    },
    UNSAFE_TILE_SIZE: {
      code: "EC_COMMON_0003",
      template:
        "Unsafe tile size: `$tileSize`. Tile size must be a safe integer greater than `0`.",
    },
    INVALID_RGBA_COLOR: {
      code: "EC_COMMON_0004",
      template: "RGBA color channels must be integers between 0 and 255.",
    },
    INVALID_CIRCLE_RADIUS: {
      code: "EC_COMMON_0005",
      template:
        "Circle radius must be a non-negative finite number, but received `$radius`.",
    },
    INVALID_CIRCLE_CENTER: {
      code: "EC_COMMON_0006",
      template:
        "Circle `$param` must be a finite number, but received `$received`.",
    },
    UNSAFE_CIRCLE_PIXEL_BOUNDS: {
      code: "EC_COMMON_0007",
      template: "Circle candidate pixel bounds exceed the safe integer range.",
    },
  },
  CAMERA: {
    INVALID_NUMBER_TYPE: {
      code: "EC_CAMERA_0001",
      template:
        "Invalid type for Camera `$param`: expected `number`, but received `$received`.",
    },
    NON_FINITE_NUMBER: {
      code: "EC_CAMERA_0002",
      template:
        "Camera `$param` must be a finite number, but received `$received`.",
    },
    INVALID_ZOOM: {
      code: "EC_CAMERA_0003",
      template: "Camera zoom must be a positive finite number.",
    },
    INVALID_VIEWPORT_SIZE: {
      code: "EC_CAMERA_0004",
      template:
        "Camera viewport `$param` must be non-negative, but received `$received`.",
    },
  },
  BRUSH: {
    INVALID_SIZE: {
      code: "EC_BRUSH_0001",
      template: "Brush size must be a positive finite number.",
    },
    INVALID_OPACITY: {
      code: "EC_BRUSH_0002",
      template: "Brush opacity must be a finite number between 0 and 1.",
    },
    INVALID_SPACING: {
      code: "EC_BRUSH_0003",
      template: "Brush spacing must be a positive finite number.",
    },
    INVALID_DYNAMICS_OBJECT: {
      code: "EC_BRUSH_0004",
      template: "Brush dynamics `$param` must be a non-array object.",
    },
    INVALID_DYNAMICS_MIN: {
      code: "EC_BRUSH_0005",
      template:
        "Brush dynamics `$param` minimum must be a finite number between 0 and 1.",
    },
    INVALID_MAX_VELOCITY: {
      code: "EC_BRUSH_0006",
      template:
        "Brush dynamics `$param` maxVelocity must be a positive finite number.",
    },
    INVALID_DYNAMICS_CURVE: {
      code: "EC_BRUSH_0007",
      template:
        "Brush dynamics `$param` curve must provide an evaluate method.",
    },
    INVALID_DYNAMICS_CURVE_OUTPUT: {
      code: "EC_BRUSH_0008",
      template:
        "Brush dynamics `$param` curve must return a finite number between 0 and 1, but received `$received`.",
    },
    INVALID_DYNAMICS_INPUT: {
      code: "EC_BRUSH_0009",
      template: "Brush dynamics input `$param` is outside its valid range.",
    },
    INVALID_RESOLVED_PARAMETERS: {
      code: "EC_BRUSH_0010",
      template: "Brush dynamics produced invalid resolved parameters.",
    },
    INVALID_IMAGE_DIMENSIONS: {
      code: "EC_BRUSH_0011",
      template:
        "Brush image dimensions must be positive safe integers with a safe pixel count.",
    },
    INVALID_IMAGE_ALPHA_BUFFER: {
      code: "EC_BRUSH_0012",
      template:
        "Brush image alpha must be a Uint8Array of length `$expected`, but received length `$received`.",
    },
    INVALID_IMAGE_RGBA_BUFFER: {
      code: "EC_BRUSH_0013",
      template:
        "Brush image RGBA pixels must be a byte array of length `$expected`, but received length `$received`.",
    },
    INVALID_BRUSH_IMAGE: {
      code: "EC_BRUSH_0014",
      template: "ImageBrush image must be a BrushImage instance.",
    },
    INVALID_IMAGE_ANCHOR: {
      code: "EC_BRUSH_0015",
      template:
        "ImageBrush anchor must contain finite x and y values between 0 and 1.",
    },
    INVALID_IMAGE_STAMP_POSITION: {
      code: "EC_BRUSH_0016",
      template:
        "ImageBrush stamp `$param` must be a finite number, but received `$received`.",
    },
    UNSAFE_IMAGE_STAMP_BOUNDS: {
      code: "EC_BRUSH_0017",
      template:
        "ImageBrush destination pixel bounds exceed the safe integer range.",
    },
    INVALID_ROTATION: {
      code: "EC_BRUSH_0018",
      template: "Brush rotation must be a finite number of radians.",
    },
    INVALID_JITTER_OBJECT: {
      code: "EC_BRUSH_0019",
      template: "Brush jitter must be a non-array object.",
    },
    INVALID_JITTER_AMPLITUDE: {
      code: "EC_BRUSH_0020",
      template: "Brush `$param` must be a non-negative finite number.",
    },
    INVALID_JITTER_PARAMETERS: {
      code: "EC_BRUSH_0021",
      template:
        "Brush jitter arithmetic overflowed; reduce brush parameters or jitter amplitudes.",
    },
  },
  RANDOM: {
    INVALID_UINT32: {
      code: "EC_RANDOM_0001",
      template: "Random `$param` must be an integer between 0 and 4294967295.",
    },
  },
  WORLD: {
    INVALID_BOUNDS: {
      code: "EC_WORLD_0001",
      template:
        "World bounds require safe-integer x and y origins plus positive safe-integer width and height.",
    },
  },
  PAINT: {
    INVALID_OPACITY: {
      code: "EC_PAINT_0001",
      template: "Paint opacity must be a finite number between 0 and 1.",
    },
    INVALID_COVERAGE: {
      code: "EC_PAINT_0002",
      template: "Pixel coverage must be a finite number between 0 and 1.",
    },
  },
  STROKE: {
    INVALID_NUMBER_TYPE: {
      code: "EC_STROKE_0001",
      template:
        "Invalid type for Stroke `$param`: expected `number`, but received `$received`.",
    },
    NON_FINITE_POSITION: {
      code: "EC_STROKE_0002",
      template:
        "Stroke sample `$param` must be finite, but received `$received`.",
    },
    INVALID_TIMESTAMP: {
      code: "EC_STROKE_0003",
      template:
        "Stroke sample timestamp must be finite, but received `$received`.",
    },
    NON_MONOTONIC_TIMESTAMP: {
      code: "EC_STROKE_0004",
      template:
        "Stroke sample timestamp must not decrease from `$previous` to `$received`.",
    },
    INVALID_STAMP_DISTANCE: {
      code: "EC_STROKE_0005",
      template:
        "Brush size `$size` and spacing `$spacing` must produce a positive finite stamp distance.",
    },
    ALREADY_ENDED: {
      code: "EC_STROKE_0006",
      template: "Cannot add a sample to an ended Stroke.",
    },
    NON_FINITE_SEGMENT: {
      code: "EC_STROKE_0007",
      template: "Stroke sample positions must produce a finite segment length.",
    },
    INVALID_SMOOTHING: {
      code: "EC_STROKE_0008",
      template:
        "Stroke smoothing must be finite and greater than 0 but no greater than 1, received `$received`.",
    },
    INVALID_RESAMPLE_DISTANCE: {
      code: "EC_STROKE_0009",
      template:
        "Stroke resample distance must be positive and finite, received `$received`.",
    },
    INVALID_PRESSURE: {
      code: "EC_STROKE_0010",
      template:
        "Stroke sample pressure must be a finite number between 0 and 1, but received `$received`.",
    },
    INVALID_TILT: {
      code: "EC_STROKE_0011",
      template:
        "Stroke sample `$param` must be a finite number between -90 and 90 degrees, but received `$received`.",
    },
    STAMP_INDEX_EXHAUSTED: {
      code: "EC_STROKE_0012",
      template:
        "Stroke stamp index space is exhausted after index 4294967295; start a new stroke.",
    },
  },
  TILE: {
    LOCAL_PIXEL_COORDINATE_OUT_OF_BOUNDS: {
      code: "EC_TILE_0001",
      template:
        "Local pixel coordinate { x: `$x`, y: `$y` } is outside the bounds of a `$tileSize` by `$tileSize` tile.",
    },
    TILE_WAS_ALREADY_EXISTS: {
      code: "EC_TILE_0002",
      template: "Tile already exists at coordinate (`$x`, `$y`).",
    },
  },
} as const satisfies Record<string, Record<string, ErrorDefinition>>;

/** Immutable error-code catalog exposed without internal message templates. */
export const ErrorCodes = deriveDefinitionCodes(ErrorDefinitions);
