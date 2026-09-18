import type { World } from "../world/World.js";
import type { RasterLayer } from "../world/RasterLayer.js";

/**
 * Enumerates contributing layers in Normal / Source Over stacking order.
 * @param world - Document observed without mutation.
 * @returns Visible, positive-opacity layers from bottom to top.
 */
export function* getWorldCompositionLayers(
  world: World,
): IterableIterator<RasterLayer> {
  for (const layer of world.layers) {
    if (layer.visible && layer.opacity > 0) {
      yield layer;
    }
  }
}
