import { Rasterizers } from "@reverie/core";
import type { PixelCoord, ScreenPoint } from "@reverie/core";

import type { BrushMode } from "./interfaces/brush/BrushMode";

/**
 * Builds the exterior of the selected geometric brush footprint.
 * Internal shared edges are omitted, leaving one SVG path rather than pixel
 * elements. Coordinates remain in world space for the camera transform.
 *
 * @param center - Continuous brush center in world pixels.
 * @param size - Brush size in world pixels, normally 1 through 32.
 * @param mode - Smooth circle coverage or an exact square pixel footprint.
 * @returns SVG path data containing only exposed pixel edges.
 * @throws Rasterizer validation errors for invalid coordinates or size.
 */
export function createBrushOutlinePath(
  center: ScreenPoint,
  size: number,
  mode: BrushMode,
): string {
  if (mode === "pixel") {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new RangeError(
        "Pixel brush outline size must be a positive safe integer.",
      );
    }
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      throw new RangeError("Pixel brush outline center must be finite.");
    }

    const halfSize = Math.floor(size / 2);
    const isOddSize = size % 2 === 1;
    const horizontalAnchor = isOddSize
      ? Math.floor(center.x)
      : Math.floor(center.x + 0.5);
    const verticalAnchor = isOddSize
      ? Math.floor(center.y)
      : Math.floor(center.y + 0.5);
    const left = horizontalAnchor - halfSize;
    const top = verticalAnchor - halfSize;

    return `M${left} ${top}h${size}v${size}h-${size}Z`;
  }

  const pixels: PixelCoord[] = [];
  const occupiedPixels = new Set<string>();

  Rasterizers.rasterizeCircle({ center, radius: size / 2 }, ({ pixel }) => {
    pixels.push(pixel);
    occupiedPixels.add(`${pixel.x}:${pixel.y}`);
  });

  const edges: string[] = [];

  for (const { x, y } of pixels) {
    if (!occupiedPixels.has(`${x}:${y - 1}`)) {
      edges.push(`M${x} ${y}h1`);
    }
    if (!occupiedPixels.has(`${x + 1}:${y}`)) {
      edges.push(`M${x + 1} ${y}v1`);
    }
    if (!occupiedPixels.has(`${x}:${y + 1}`)) {
      edges.push(`M${x + 1} ${y + 1}h-1`);
    }
    if (!occupiedPixels.has(`${x - 1}:${y}`)) {
      edges.push(`M${x} ${y + 1}v-1`);
    }
  }

  return edges.join("");
}
