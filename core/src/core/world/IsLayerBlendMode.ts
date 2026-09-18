import type { LayerBlendMode } from "../../interfaces/world/LayerBlendMode.js";
import { LAYER_BLEND_MODES } from "../../config/world/LayerBlendModes.js";

/**
 * Checks whether an unknown value is one of the supported World layer blend modes.
 * @param value - Candidate mode received from an external caller.
 * @returns `true` when the value can be assigned to a layer's blend mode.
 */
export function isLayerBlendMode(value: unknown): value is LayerBlendMode {
  return LAYER_BLEND_MODES.some((mode) => mode === value);
}
