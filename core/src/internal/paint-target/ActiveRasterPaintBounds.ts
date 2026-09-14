import type { Raster } from "../../core/raster/Raster.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";

/** Active bounded-paint scopes keyed by their otherwise unbounded Raster. */
const ACTIVE_BOUNDS = new WeakMap<Raster, (WorldBounds | null)[]>();

/**
 * Executes a synchronous operation with a temporary clipping region.
 *
 * Nested scopes are restored in stack order, including when painting throws.
 *
 * @typeParam Result - Value returned by the scoped operation.
 * @param raster - Raster whose writes are temporarily constrained.
 * @param bounds - Half-open write region, or `null` for no clipping.
 * @param operation - Synchronous work performed inside the clipping scope.
 * @returns The operation result.
 */
export function withRasterPaintBounds<Result>(
  raster: Raster,
  bounds: WorldBounds | null,
  operation: () => Result,
): Result {
  const existingStack = ACTIVE_BOUNDS.get(raster);
  const stack = existingStack ?? [];

  if (existingStack === undefined) {
    ACTIVE_BOUNDS.set(raster, stack);
  }

  stack.push(bounds);

  try {
    return operation();
  } finally {
    stack.pop();

    if (stack.length === 0) {
      ACTIVE_BOUNDS.delete(raster);
    }
  }
}

/**
 * Checks whether a trusted pixel may be written in the current paint scope.
 *
 * This numeric hot path intentionally runs before tile-coordinate mapping and
 * allocation. A Raster outside any scope remains fully unbounded.
 *
 * @param raster - Raster about to receive a pixel write.
 * @param pixelX - Safe-integer world-pixel X coordinate.
 * @param pixelY - Safe-integer world-pixel Y coordinate.
 * @returns `true` when the active target permits the write.
 */
export function isRasterPixelWritable(
  raster: Raster,
  pixelX: number,
  pixelY: number,
): boolean {
  const stack = ACTIVE_BOUNDS.get(raster);
  const bounds = stack?.[stack.length - 1];

  if (bounds === undefined || bounds === null) {
    return true;
  }

  return (
    pixelX >= bounds.x &&
    pixelX - bounds.x < bounds.width &&
    pixelY >= bounds.y &&
    pixelY - bounds.y < bounds.height
  );
}
