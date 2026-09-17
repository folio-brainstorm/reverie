import { Rasterizers } from "@reverie/core";
import type { PixelCoord, ScreenPoint } from "@reverie/core";

/**
 * Builds the exterior of the exact pixel footprint used by the circle brush.
 * Internal shared edges are omitted, leaving one SVG path rather than pixel
 * elements. Coordinates remain in world space for the camera transform.
 *
 * @param center - Continuous brush center in world pixels.
 * @param size - Circle diameter in world pixels, normally 1 through 32.
 * @returns SVG path data containing only exposed pixel edges.
 * @throws Rasterizer validation errors for invalid coordinates or size.
 */
export function createBrushOutlinePath(
  center: ScreenPoint,
  size: number,
): string {
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
