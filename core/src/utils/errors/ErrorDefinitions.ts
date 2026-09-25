import type { ErrorDefinition } from "../../interfaces/errors/ErrorDefinition.js";
import { PAINT_MODES } from "../../config/paint/PaintModes.js";
import { LAYER_BLEND_MODES } from "../../config/world/LayerBlendModes.js";
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
  RENDERING: {
    INVALID_REQUEST: {
      code: "EC_RENDERING_0001",
      template: "Render request must provide a viewport object.",
    },
    INVALID_VIEWPORT_COMPONENT_TYPE: {
      code: "EC_RENDERING_0002",
      template:
        "Render viewport `$component` must be a number, but received `$received`.",
    },
    INVALID_VIEWPORT_COMPONENT_VALUE: {
      code: "EC_RENDERING_0003",
      template:
        "Render viewport `$component` must be finite, but received `$received`.",
    },
    INVALID_VIEWPORT_EXTENT: {
      code: "EC_RENDERING_0004",
      template: "Render viewport width and height must be non-negative.",
    },
    INVALID_RENDER_BUDGET: {
      code: "EC_RENDERING_0005",
      template:
        "Render budget `$component` must be a positive finite value that can make progress.",
    },
    INVALID_LOD_STRATEGY_RESULT: {
      code: "EC_RENDERING_0006",
      template:
        "Render LOD strategy returned invalid output tile size `$outputTileSize` for source tile size `$tileSize`.",
    },
    INVALID_RENDER_QUALITY: {
      code: "EC_RENDERING_0007",
      template: "Render quality must be `full` or `interactive`.",
    },
    INVALID_DIAGNOSTICS_TIMINGS: {
      code: "EC_RENDERING_0008",
      template: "Render timing diagnostics setting must be a boolean.",
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
    INVALID_SCATTER_OBJECT: {
      code: "EC_BRUSH_0022",
      template: "Brush scatter must be a non-array object.",
    },
    INVALID_SCATTER_AMPLITUDE: {
      code: "EC_BRUSH_0023",
      template: "Brush `$param` must be a non-negative finite number.",
    },
    INVALID_SCATTER_DIRECTION: {
      code: "EC_BRUSH_0024",
      template: "Brush scatter direction must be a finite number of radians.",
    },
    INVALID_SCATTER_RESULT: {
      code: "EC_BRUSH_0025",
      template: "Brush scatter produced a non-finite `$param`.",
    },
    INVALID_RESOLVED_SPACING: {
      code: "EC_BRUSH_0026",
      template:
        "Brush dynamics and spacing jitter must produce a finite positive stamp interval.",
    },
    INVALID_PIXEL_SIZE: {
      code: "EC_BRUSH_0027",
      template: "PixelBrush size must be a positive safe integer.",
    },
    INVALID_PIXEL_STAMP_POSITION_TYPE: {
      code: "EC_BRUSH_0028",
      template:
        "PixelBrush stamp `$param` must be a number, but received `$received`.",
    },
    INVALID_PIXEL_STAMP_POSITION: {
      code: "EC_BRUSH_0029",
      template:
        "PixelBrush stamp `$param` must be finite, but received `$received`.",
    },
    UNSAFE_PIXEL_STAMP_BOUNDS: {
      code: "EC_BRUSH_0030",
      template:
        "PixelBrush destination pixel bounds exceed the safe integer range.",
    },
  },
  RANDOM: {
    INVALID_UINT32: {
      code: "EC_RANDOM_0001",
      template: "Random `$param` must be an integer between 0 and 4294967295.",
    },
  },
  WORLD: {
    INVALID_LAYER_OPACITY: {
      code: "EC_WORLD_0002",
      template: "Layer opacity must be a finite number between 0 and 1.",
    },
    INVALID_LAYER_INDEX: {
      code: "EC_WORLD_0003",
      template:
        "Layer index must be a safe integer within the document layer range.",
    },
    LAYER_NOT_FOUND: {
      code: "EC_WORLD_0004",
      template: "The supplied layer does not belong to this World.",
    },
    LAST_LAYER_REMOVAL: {
      code: "EC_WORLD_0005",
      template: "The last remaining layer cannot be removed.",
    },
    DUPLICATE_LAYER_OWNERSHIP: {
      code: "EC_WORLD_0006",
      template: "This layer or its Raster is already registered in a World.",
    },
    INCOMPATIBLE_LAYER: {
      code: "EC_WORLD_0007",
      template:
        "Layer tile size and paint bounds must match the destination World.",
    },
    REENTRANT_LAYER_CHANGE: {
      code: "EC_WORLD_0008",
      template:
        "Cannot change layer membership or order from a layer removal callback.",
    },
    INVALID_LAYER_BLEND_MODE: {
      code: "EC_WORLD_0009",
      template: `Layer blend mode must be one of: ${LAYER_BLEND_MODES.join(", ")}.`,
    },
    INVALID_BOUNDS: {
      code: "EC_WORLD_0001",
      template:
        "World bounds require safe-integer x and y origins plus positive safe-integer width and height.",
    },
    EMPTY_INITIAL_LAYERS: {
      code: "EC_WORLD_0010",
      template: "World initialLayers must contain at least one detached Layer.",
    },
  },
  PAINT: {
    INVALID_MODE: {
      code: "EC_PAINT_0003",
      template: `Paint mode must be one of: ${PAINT_MODES.join(", ")}.`,
    },
    INVALID_ERASE_AMOUNT: {
      code: "EC_PAINT_0004",
      template: "Erase amount must be a finite number between 0 and 1.",
    },
    INVALID_OPACITY: {
      code: "EC_PAINT_0001",
      template: "Paint opacity must be a finite number between 0 and 1.",
    },
    INVALID_COVERAGE: {
      code: "EC_PAINT_0002",
      template: "Pixel coverage must be a finite number between 0 and 1.",
    },
  },
  SELECTION: {
    INVALID_COVERAGE: {
      code: "EC_SELECTION_0001",
      template: "Selection coverage must be a finite number between 0 and 1.",
    },
    INVALID_RECT: {
      code: "EC_SELECTION_0002",
      template:
        "Selection rectangle requires safe-integer x and y origins, positive safe-integer dimensions, safe half-open bounds, and a safe pixel count.",
    },
  },
  HISTORY: {
    GROUP_ALREADY_ACTIVE: {
      code: "EC_HISTORY_0001",
      template: "Cannot begin a History group while another group is active.",
    },
    GROUP_NOT_ACTIVE: {
      code: "EC_HISTORY_0002",
      template: "Cannot finish a History group because no group is active.",
    },
    DOCUMENT_MUTATION_DURING_RASTER_EDIT: {
      code: "EC_HISTORY_0003",
      template:
        "Finish the active Raster edit before changing Layer document state.",
    },
    INVALID_RASTER_TRANSACTION_STATE: {
      code: "EC_HISTORY_0004",
      template:
        "Raster History transaction cannot perform `$operation` after it has `$state`.",
    },
    INVALID_BYTE_BUDGET: {
      code: "EC_HISTORY_0005",
      template: "History byte budget must be a positive safe integer.",
    },
    OPERATION_DURING_GROUP: {
      code: "EC_HISTORY_0006",
      template:
        "Commit or cancel the active History group before `$operation`.",
    },
    NESTED_RASTER_MUTATION: {
      code: "EC_HISTORY_0007",
      template:
        "Nested Raster History mutation scopes on the same Raster are unsupported.",
    },
  },
  DOCUMENT: {
    INVALID_DOCUMENT_FORMAT: {
      code: "EC_DOCUMENT_0001",
      template: "Serialized document format must be `reverie-document`.",
    },
    INVALID_DOCUMENT_SCHEMA: {
      code: "EC_DOCUMENT_0002",
      template: "Serialized document schema is invalid: $reason.",
    },
    UNSUPPORTED_DOCUMENT_VERSION: {
      code: "EC_DOCUMENT_0003",
      template: "Serialized document version `$version` is unsupported.",
    },
    UNSUPPORTED_DOCUMENT_FEATURE: {
      code: "EC_DOCUMENT_0004",
      template: "Serialized document requires unsupported feature `$feature`.",
    },
    DOCUMENT_MIGRATION_FAILED: {
      code: "EC_DOCUMENT_0005",
      template:
        "Serialized document migration from version `$fromVersion` to `$toVersion` failed.",
    },
    DUPLICATE_LAYER_ID: {
      code: "EC_DOCUMENT_0006",
      template: "Document Layer identifier `$id` is duplicated.",
    },
    INVALID_DOCUMENT_ID: {
      code: "EC_DOCUMENT_0007",
      template: "Document and Layer identifiers must be non-empty strings.",
    },
    INVALID_DOCUMENT_FEATURE: {
      code: "EC_DOCUMENT_0008",
      template: "Document feature identifiers must be non-empty strings.",
    },
    INVALID_RASTER_SCHEMA: {
      code: "EC_DOCUMENT_0009",
      template: "Serialized Raster schema is invalid: $reason.",
    },
    UNSUPPORTED_PIXEL_FORMAT: {
      code: "EC_DOCUMENT_0010",
      template: "Serialized Raster pixel format `$pixelFormat` is unsupported.",
    },
    UNSUPPORTED_RASTER_ENCODING: {
      code: "EC_DOCUMENT_0011",
      template:
        "Serialized Raster payload encoding `$encoding` is unsupported.",
    },
    INVALID_TILE_PAYLOAD: {
      code: "EC_DOCUMENT_0012",
      template:
        "Serialized Raster tile `$index` must contain `$expected` raw bytes, but received `$received`.",
    },
    DUPLICATE_TILE_COORDINATE: {
      code: "EC_DOCUMENT_0013",
      template: "Serialized Raster tile coordinate (`$x`, `$y`) is duplicated.",
    },
    UNSUPPORTED_TILE_SIZE: {
      code: "EC_DOCUMENT_0014",
      template: "Serialized Raster tile size `$tileSize` is unsupported.",
    },
    DOCUMENT_HYDRATION_FAILED: {
      code: "EC_DOCUMENT_0015",
      template: "Serialized document could not be hydrated into runtime state.",
    },
    UNSUPPORTED_READER_VERSION: {
      code: "EC_DOCUMENT_0016",
      template:
        "Serialized document requires reader version `$requiredVersion`, but this reader supports through `$supportedVersion`.",
    },
  },
  PROJECT: {
    INVALID_PROJECT_FORMAT: {
      code: "EC_PROJECT_0001",
      template:
        "Project container bytes do not use the Reverie project format.",
    },
    UNSUPPORTED_PROJECT_VERSION: {
      code: "EC_PROJECT_0002",
      template: "Project container version `$version` is unsupported.",
    },
    INVALID_PROJECT_MANIFEST: {
      code: "EC_PROJECT_0003",
      template: "Project manifest is missing or malformed.",
    },
    MISSING_PROJECT_DOCUMENT: {
      code: "EC_PROJECT_0004",
      template: "Project container does not contain a document metadata entry.",
    },
    DUPLICATE_PROJECT_ENTRY: {
      code: "EC_PROJECT_0005",
      template: "Project container entry `$entry` is duplicated.",
    },
    MISSING_PROJECT_PAYLOAD: {
      code: "EC_PROJECT_0006",
      template: "Project container is missing Raster payload entry `$entry`.",
    },
    INVALID_PROJECT_PAYLOAD: {
      code: "EC_PROJECT_0007",
      template: "Project Raster payload metadata or binary entry is invalid.",
    },
    EMPTY_PROJECT: {
      code: "EC_PROJECT_0008",
      template: "A project requires at least one allocated Raster tile.",
    },
    INVALID_PROJECT_PREVIEW: {
      code: "EC_PROJECT_0009",
      template:
        "Project preview requires a valid MIME type and Uint8Array data.",
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
    INVALID_RESOLVED_STAMP_DISTANCE: {
      code: "EC_STROKE_0013",
      template:
        "Brush resolved stamp distance must be a finite positive number, but received `$received`.",
    },
    STAMP_PLACEMENT_NO_PROGRESS: {
      code: "EC_STROKE_0014",
      template:
        "Stamp placement cannot advance with the resolved interval at the current numeric precision.",
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
