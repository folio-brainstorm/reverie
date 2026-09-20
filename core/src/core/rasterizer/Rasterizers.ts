import type {
  Circle,
  PixelCoverageVisitor,
} from "../../interfaces/rasterizers/Rasterizers.js";

import { rasterizeCirclePixels } from "../../internal/rasterizer/RasterizeCirclePixels.js";

export namespace Rasterizers {
  /**
   * Rasterizes a continuous circle into normalized per-pixel coverage.
   *
   * Candidate pixels are visited in row-major order. Ordinary circles use a
   * one-pixel signed-distance transition around the boundary. Circles smaller
   * than one pixel use area-aware coverage so they remain visible at subpixel
   * positions while their total contribution approaches zero with size. The
   * callback is invoked exactly once for each pixel with positive coverage.
   *
   * @param circle - Circle expressed in continuous world coordinates.
   * @param callback - Visitor invoked once for every hit pixel.
   * @throws {ReverieTypeError} A center component is not a number.
   * @throws {ReverieRangeError} A center component is not finite or the radius
   * is invalid, or the resulting pixel bounds exceed the safe integer range.
   * @example
   * rasterizeCircle(
   *   { center: { x: 0.5, y: 0.5 }, radius: 1 },
   *   ({ pixel, coverage }) => consume(pixel, coverage),
   * );
   */
  export function rasterizeCircle(
    circle: Circle,
    callback: PixelCoverageVisitor,
  ): void {
    rasterizeCirclePixels(circle, (x, y, coverage) => {
      callback({ pixel: { x, y }, coverage });
    });
  }
}
