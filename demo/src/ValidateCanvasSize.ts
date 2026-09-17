import type { CanvasSize } from "./interfaces/canvas/CanvasSize";

const MIN_CANVAS_DIMENSION = 1;
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_PIXELS = 4096 * 4096;

/**
 * Validates user-selected dimensions before allocating a drawing runtime.
 *
 * @param size - Width and height in pixels, each an integer from 1 to 8192.
 * @returns An actionable error, or null for a size within the total pixel budget.
 */
export function validateCanvasSize(size: CanvasSize): string | null {
  const dimensions = [size.width, size.height];
  if (!dimensions.every(Number.isSafeInteger)) {
    return "Enter a whole number for both width and height.";
  }
  if (
    dimensions.some(
      (dimension) =>
        dimension < MIN_CANVAS_DIMENSION || dimension > MAX_CANVAS_DIMENSION,
    )
  ) {
    return `Width and height must each be between ${MIN_CANVAS_DIMENSION} and ${MAX_CANVAS_DIMENSION} pixels.`;
  }
  if (size.width * size.height > MAX_CANVAS_PIXELS) {
    return "This canvas is too large. Use no more pixels than a 4096 × 4096 canvas.";
  }
  return null;
}
