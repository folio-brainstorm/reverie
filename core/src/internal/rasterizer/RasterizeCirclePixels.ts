import type { CirclePixelVisitor } from "../../interfaces/rasterizers/CirclePixelVisitor.js";
import type { Circle } from "../../interfaces/rasterizers/Rasterizers.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { assertFiniteCircleCenterComponent } from "../../utils/number/math/AssertFiniteCircleCenterComponent.js";
import { isValidCircleRadius } from "../../utils/number/math/IsValidCircleRadius.js";

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

  const minX = normalizeZero(Math.ceil(center.x - radius - 0.5));
  const maxX = normalizeZero(Math.floor(center.x + radius - 0.5));
  const minY = normalizeZero(Math.ceil(center.y - radius - 0.5));
  const maxY = normalizeZero(Math.floor(center.y + radius - 0.5));

  assertSafePixelBounds(minX, maxX, minY, maxY);

  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;

      if (dx * dx + dy * dy <= radiusSquared) {
        callback(x, y, 1);
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
