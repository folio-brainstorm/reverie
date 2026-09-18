import type { ErrorDefinition } from "@reverie/core";

/** Renderer-owned message templates paired with stable renderer error codes. */
export const RendererErrorDefinitions = {
  INVALID_RENDER_SOURCE: {
    code: "EC_RENDERER_0004",
    template: "Supply exactly one rendering source: Raster or World.",
  },
  FAILED_TO_ACQUIRE_RENDERING_CONTEXT: {
    code: "EC_RENDERER_0001",
    template: "Failed to acquire 2D rendering context.",
  },
  INVALID_CANVAS_SIZE: {
    code: "EC_RENDERER_0002",
    template:
      "Canvas dimensions must be non-negative finite integers. Received width: `$width`; height: `$height`.",
  },
  INVALID_PIXEL_RATIO: {
    code: "EC_RENDERER_0003",
    template:
      "Canvas pixel ratio must be a positive finite number, but received `$pixelRatio`.",
  },
} as const satisfies Record<string, ErrorDefinition>;
