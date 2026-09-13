import type {
  Circle,
  PixelCoverageVisitor,
} from "../../interfaces/rasterizers/Rasterizers.js";

import { rasterizeCirclePixels } from "../../internal/rasterizer/RasterizeCirclePixels.js";

export namespace Rasterizers {
  /**
   * Rasterizes a continuous circle using a binary pixel-center coverage test.
   *
   * Candidate pixels are visited in row-major order. A callback occurs exactly
   * once for each pixel whose center lies on or inside the circle, and every
   * emitted hit has coverage `1`.
   *
   * @param circle - Circle expressed in continuous world coordinates.
   * @param callback - Visitor invoked once for every hit pixel.
   * @throws {ReverieTypeError} A center component is not a number.
   * @throws {ReverieRangeError} A center component is not finite or the radius
   * is invalid, or the resulting pixel bounds exceed the safe integer range.
   * @example
   * rasterizeCircle(
   *   { center: { x: 0.5, y: 0.5 }, radius: 0 },
   *   ({ pixel }) => consume(pixel),
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
