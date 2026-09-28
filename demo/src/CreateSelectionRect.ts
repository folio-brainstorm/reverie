import type { Rect, WorldPoint } from "@reveriejs/core";

import type { CanvasSize } from "./interfaces/canvas/CanvasSize";

/**
 * Resolves an inclusive pixel drag into a clamped half-open Selection rectangle.
 *
 * Both endpoints identify the world pixel under the pointer, so a click selects
 * exactly one pixel and reverse-direction drags produce the same rectangle.
 *
 * @param anchor - World-space pointer position where the drag began.
 * @param current - Current or final world-space pointer position.
 * @param canvasSize - Positive integer document bounds beginning at the origin.
 * @returns Integer half-open rectangle contained by the document.
 */
export function createSelectionRect(
  anchor: WorldPoint,
  current: WorldPoint,
  canvasSize: CanvasSize,
): Rect {
  const anchorX = clampPixel(Math.floor(anchor.x), canvasSize.width);
  const anchorY = clampPixel(Math.floor(anchor.y), canvasSize.height);
  const currentX = clampPixel(Math.floor(current.x), canvasSize.width);
  const currentY = clampPixel(Math.floor(current.y), canvasSize.height);
  const x = Math.min(anchorX, currentX);
  const y = Math.min(anchorY, currentY);

  return {
    x,
    y,
    width: Math.abs(currentX - anchorX) + 1,
    height: Math.abs(currentY - anchorY) + 1,
  };
}

/** Clamps one floored coordinate to a valid document pixel index. */
function clampPixel(pixel: number, dimension: number): number {
  return Math.min(dimension - 1, Math.max(0, pixel));
}
