import type { RenderRegion } from "@reveriejs/core/rendering";

import type { PresentationCacheContext } from "../interfaces/presentation/PresentationCacheContext.js";

/** One power-of-two deficit is acceptable during interactive presentation. */
export const MAX_INTERACTIVE_PRESENTATION_SCALE = 2;

/** Independent edge snapping can add one device pixel to a projected tile. */
const SNAPPED_EDGE_ALLOWANCE = 1;

/**
 * Measures the largest actual snapped device-space upscale on either axis.
 * @param region - Core output whose square pixel buffer will be uploaded.
 * @param context - Camera projection for the current Canvas presentation.
 * @returns The larger of horizontal and vertical destination/source ratios.
 */
export function getPresentationScale(
  region: RenderRegion,
  context: PresentationCacheContext,
): number {
  const sourceSize = Math.sqrt(region.pixels.length / 4);
  const scale = Number(context.scaleKey);
  const panX = context.panX ?? context.viewport.x;
  const panY = context.panY ?? context.viewport.y;
  const left = snapDeviceBoundary((region.bounds.x - panX) * scale);
  const right = snapDeviceBoundary(
    (region.bounds.x + region.bounds.width - panX) * scale,
  );
  const top = snapDeviceBoundary((region.bounds.y - panY) * scale);
  const bottom = snapDeviceBoundary(
    (region.bounds.y + region.bounds.height - panY) * scale,
  );
  return Math.max((right - left) / sourceSize, (bottom - top) / sourceSize);
}

/**
 * Checks the 2× interactive limit using actual pixels and projected bounds.
 * Full source-resolution tiles remain usable at deliberate camera magnification.
 * @param region - Core output whose square pixel buffer will be uploaded.
 * @param context - Camera projection for the current Canvas presentation.
 * @returns Whether this buffer is sufficiently dense for the device bounds.
 */
export function hasSufficientPresentationDensity(
  region: RenderRegion,
  context: PresentationCacheContext,
): boolean {
  const sourceSize = Math.sqrt(region.pixels.length / 4);
  if (sourceSize >= region.bounds.width && sourceSize >= region.bounds.height) {
    return true;
  }
  return (
    getPresentationScale(region, context) * sourceSize <=
    MAX_INTERACTIVE_PRESENTATION_SCALE * sourceSize + SNAPPED_EDGE_ALLOWANCE
  );
}

/** Mirrors CanvasBackend's symmetric snapping of a shared device edge. */
function snapDeviceBoundary(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}
