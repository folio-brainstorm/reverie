import type { ErrorDefinition } from "@reverie/core";

/** Stable codes for failures emitted by renderer backends. */
export const RendererErrorCodes = Object.freeze({
  FAILED_TO_ACQUIRE_RENDERING_CONTEXT: "EC_RENDERER_0001",
  INVALID_CANVAS_SIZE: "EC_RENDERER_0002",
  INVALID_PIXEL_RATIO: "EC_RENDERER_0003",
} as const);

/** Renderer-owned message templates paired with stable renderer error codes. */
export const RendererErrorDefinitions = Object.freeze({
  FAILED_TO_ACQUIRE_RENDERING_CONTEXT: {
    code: RendererErrorCodes.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
    template: "Failed to acquire 2D rendering context.",
  },
  INVALID_CANVAS_SIZE: {
    code: RendererErrorCodes.INVALID_CANVAS_SIZE,
    template:
      "Canvas dimensions must be non-negative finite integers. Received width: `$width`; height: `$height`.",
  },
  INVALID_PIXEL_RATIO: {
    code: RendererErrorCodes.INVALID_PIXEL_RATIO,
    template:
      "Canvas pixel ratio must be a positive finite number, but received `$pixelRatio`.",
  },
} as const satisfies Record<string, ErrorDefinition>);
