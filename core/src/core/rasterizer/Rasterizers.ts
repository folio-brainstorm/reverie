import type {
  Circle,
  PixelCoverageVisitor,
} from "../../interfaces/rasterizers/Rasterizers.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isValidCircleRadius } from "../../utils/number/math/IsValidCircleRadius.js";

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
    const { center, radius } = circle;

    assertFiniteCenterComponent(center.x, "center.x");
    assertFiniteCenterComponent(center.y, "center.y");

    if (!isValidCircleRadius(radius)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.INVALID_CIRCLE_RADIUS,
        { radius },
      );
    }

    const minX = normalizeZero(Math.ceil(center.x - radius - 0.5));
    const maxX = normalizeZero(Math.floor(center.x + radius - 0.5));
    const minY = normalizeZero(Math.ceil(center.y - radius - 0.5));
    const maxY = normalizeZero(Math.floor(center.y + radius - 0.5));

    assertSafePixelBounds(minX, maxX, minY, maxY);

    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;

        if (dx * dx + dy * dy <= radiusSquared) {
          callback({ pixel: { x, y }, coverage: 1 });
        }
      }
    }
  }

  /** Prevents JavaScript's negative zero from leaking into pixel coordinates. */
  function normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
  }

  /** Ensures integer iteration can advance and every emitted pixel is addressable. */
  function assertSafePixelBounds(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): void {
    const bounds = [minX, maxX, minY, maxY];

    if (!bounds.every(Number.isSafeInteger)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_CIRCLE_PIXEL_BOUNDS,
      );
    }
  }

  /** Validates one continuous coordinate at the public rasterizer boundary. */
  function assertFiniteCenterComponent(
    value: unknown,
    parameterName: "center.x" | "center.y",
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(
        ErrorDefinitions.COMMON.INVALID_COORDINATE_TYPE,
        {
          param: parameterName,
          expected: "number",
          received: typeof value,
        },
      );
    }

    if (!Number.isFinite(value)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.INVALID_CIRCLE_CENTER,
        {
          param: parameterName,
          received: value,
        },
      );
    }
  }

}
