import type { CirclePixelVisitor } from "../../interfaces/rasterizers/CirclePixelVisitor.js";
import type { Circle } from "../../interfaces/rasterizers/Rasterizers.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { assertFiniteCircleCenterComponent } from "../../utils/number/math/AssertFiniteCircleCenterComponent.js";
import { isValidCircleRadius } from "../../utils/number/math/IsValidCircleRadius.js";
import { resolveSmallCirclePixelCoverage } from "./ResolveSmallCirclePixelCoverage.js";

const SMALL_CIRCLE_RADIUS_THRESHOLD = 0.5;

/**
 * Validates and rasterizes a continuous circle with allocation-light hits.
 *
 * Public rasterizers and trusted brush paths share this geometry so their
 * covered pixel sets cannot diverge.
 *
 * @param circle - Circle expressed in continuous world coordinates.
 * @param callback - Visitor receiving primitive pixel coordinates and coverage.
 */
export function rasterizeCirclePixels(
  circle: Circle,
  callback: CirclePixelVisitor,
): void {
  const { center, radius } = circle;

  assertFiniteCircleCenterComponent(center.x, "center.x");
  assertFiniteCircleCenterComponent(center.y, "center.y");

  if (!isValidCircleRadius(radius)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.COMMON.INVALID_CIRCLE_RADIUS,
      {
        radius,
      },
    );
  }

  const minX = normalizeZero(Math.ceil(center.x - radius - 1));
  const maxX = normalizeZero(Math.floor(center.x + radius));
  const minY = normalizeZero(Math.ceil(center.y - radius - 1));
  const maxY = normalizeZero(Math.floor(center.y + radius));

  assertSafePixelBounds(minX, maxX, minY, maxY);

  if (radius < SMALL_CIRCLE_RADIUS_THRESHOLD) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const coverage = resolveSmallCirclePixelCoverage(
          center.x,
          center.y,
          radius,
          x,
          y,
        );

        if (coverage > 0) {
          callback(x, y, coverage);
        }
      }
    }
    return;
  }

  const antiAliasedRadius = radius + 0.5;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const deltaX = x + 0.5 - center.x;
      const deltaY = y + 0.5 - center.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const coverage = antiAliasedRadius - distance;

      if (coverage > 0) {
        callback(x, y, coverage >= 1 ? 1 : coverage);
      }
    }
  }
}

/** Prevents JavaScript's negative zero from leaking into pixel coordinates. */
function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Ensures integer iteration can advance and emitted pixels are addressable. */
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
