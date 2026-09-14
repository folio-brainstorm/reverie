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
