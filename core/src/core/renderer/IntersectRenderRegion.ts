import type { WorldRect } from "../../interfaces/camera/WorldRect.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";

/**
 * Intersects a validated render region with optional half-open document bounds.
 * Continuous camera viewports and integer export regions share this geometry.
 * @param region - Finite region with nonnegative extents validated by its caller.
 * @param bounds - Document bounds, or `null` to leave the region unbounded.
 * @returns The nonempty intersection, or `null` when there are no pixels to traverse.
 */
export function intersectRenderRegion(
  region: WorldRect,
  bounds: WorldBounds | null,
): WorldRect | null {
  const left = bounds === null ? region.x : Math.max(region.x, bounds.x);
  const top = bounds === null ? region.y : Math.max(region.y, bounds.y);
  const right =
    bounds === null
      ? region.x + region.width
      : Math.min(region.x + region.width, bounds.x + bounds.width);
  const bottom =
    bounds === null
      ? region.y + region.height
      : Math.min(region.y + region.height, bounds.y + bounds.height);
  if (left >= right || top >= bottom) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
