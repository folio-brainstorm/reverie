import type { LAYER_BLEND_MODES } from "../../config/world/LayerBlendModes.js";

/** Blend modes supported when a World composes one layer over another. */
export type LayerBlendMode = (typeof LAYER_BLEND_MODES)[number];
