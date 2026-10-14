import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { Rect } from "../../interfaces/pixel/Rect.js";
import type { PolygonExactNumber } from "../../interfaces/selection/PolygonExactNumber.js";

/**
 * Finds the first pixel center at or to the right of an edge's scanline crossing.
 *
 * Fast floating-point comparisons are certified by an arithmetic error bound.
 * Ambiguous comparisons use exact binary arithmetic, so a real subpixel offset
 * is preserved rather than snapped to a fixed geometric tolerance.
 *
 * @param start - First finite world-space endpoint.
 * @param end - Second finite world-space endpoint.
 * @param bounds - Validated integer rasterization origin and candidate dimensions.
 * @param localY - Integer scanline offset relative to the candidate origin.
 * @returns Half-open span boundary, or undefined when the edge does not cross.
 */
export function resolvePolygonCrossingPixel(
  start: WorldPoint,
  end: WorldPoint,
  bounds: Rect,
  localY: number,
): number | undefined {
  const lower = start.y <= end.y ? start : end;
  const upper = start.y <= end.y ? end : start;
  if (
    lower.y === upper.y ||
    compareVertexY(lower.y, bounds.y, localY) > 0 ||
    compareVertexY(upper.y, bounds.y, localY) <= 0
  )
    return undefined;

  const centerY = localY + 0.5;
  const crossing =
    lower.x -
    bounds.x +
    ((centerY - (lower.y - bounds.y)) * (upper.x - lower.x)) /
      (upper.y - lower.y);
  const pixelX = Math.max(0, Math.min(bounds.width, Math.ceil(crossing - 0.5)));
  if (
    pixelX > 0 &&
    compareCrossingToCenter(lower, upper, bounds, pixelX - 1, localY) <= 0
  ) {
    return searchCrossingPixel(lower, upper, bounds, localY, 0, pixelX - 1);
  }
  if (
    pixelX < bounds.width &&
    compareCrossingToCenter(lower, upper, bounds, pixelX, localY) > 0
  ) {
    return searchCrossingPixel(
      lower,
      upper,
      bounds,
      localY,
      pixelX + 1,
      bounds.width,
    );
  }
  return pixelX;
}

/** Bounds correction is logarithmic even when a very shallow edge loses precision. */
function searchCrossingPixel(
  lower: WorldPoint,
  upper: WorldPoint,
  bounds: Rect,
  localY: number,
  minimumX: number,
  maximumX: number,
): number {
  let left = minimumX;
  let right = maximumX;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (compareCrossingToCenter(lower, upper, bounds, middle, localY) > 0)
      left = middle + 1;
    else right = middle;
  }
  return left;
}

/** Compares an endpoint to an exact half-pixel center without rounding a world sum. */
function compareVertexY(value: number, origin: number, pixel: number): number {
  const delta = value - origin - (pixel + 0.5);
  const error =
    Number.EPSILON * 4 * (Math.abs(value) + Math.abs(origin) + pixel + 0.5);
  if (Math.abs(delta) > error) return Math.sign(delta);
  return compare(toExact(value), exactCenter(origin, pixel));
}

/** Cross-multiplication certifies the approximate boundary or resolves it exactly. */
function compareCrossingToCenter(
  lower: WorldPoint,
  upper: WorldPoint,
  bounds: Rect,
  pixelX: number,
  pixelY: number,
): number {
  const deltaX = upper.x - lower.x;
  const deltaY = upper.y - lower.y;
  const offsetX = pixelX + 0.5 - (lower.x - bounds.x);
  const offsetY = pixelY + 0.5 - (lower.y - bounds.y);
  const left = deltaX * offsetY;
  const right = deltaY * offsetX;
  const determinant = left - right;
  const error =
    Number.EPSILON *
    8 *
    (Math.abs(left) +
      Math.abs(right) +
      (Math.abs(lower.x) + Math.abs(upper.x) + Math.abs(bounds.x)) * deltaY +
      (Math.abs(lower.y) + Math.abs(upper.y) + Math.abs(bounds.y)) *
        Math.abs(deltaX));
  if (Math.abs(determinant) > error) return Math.sign(determinant);

  const exactDeltaX = subtract(toExact(upper.x), toExact(lower.x));
  const exactDeltaY = subtract(toExact(upper.y), toExact(lower.y));
  const exactOffsetX = subtract(
    exactCenter(bounds.x, pixelX),
    toExact(lower.x),
  );
  const exactOffsetY = subtract(
    exactCenter(bounds.y, pixelY),
    toExact(lower.y),
  );
  return compare(
    multiply(exactDeltaX, exactOffsetY),
    multiply(exactDeltaY, exactOffsetX),
  );
}

/** Decodes a finite IEEE-754 double into an exact integer times a power of two. */
function toExact(value: number): PolygonExactNumber {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  const high = bits.getUint32(0);
  const low = bits.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const coefficient = exponentBits === 0 ? fraction : fraction | (1n << 52n);
  return {
    coefficient: high >>> 31 === 0 ? coefficient : -coefficient,
    exponent: (exponentBits === 0 ? -1022 : exponentBits - 1023) - 52,
  };
}

/** Keeps the half-pixel term exact even near safe-integer coordinate limits. */
function exactCenter(origin: number, pixel: number): PolygonExactNumber {
  return add(add(toExact(origin), toExact(pixel)), toExact(0.5));
}

/** Aligns binary exponents before exact addition. */
function add(
  left: PolygonExactNumber,
  right: PolygonExactNumber,
): PolygonExactNumber {
  const exponent = Math.min(left.exponent, right.exponent);
  return {
    coefficient:
      (left.coefficient << BigInt(left.exponent - exponent)) +
      (right.coefficient << BigInt(right.exponent - exponent)),
    exponent,
  };
}

/** Subtracts exact values without changing either operand. */
function subtract(
  left: PolygonExactNumber,
  right: PolygonExactNumber,
): PolygonExactNumber {
  return add(left, {
    coefficient: -right.coefficient,
    exponent: right.exponent,
  });
}

/** Multiplies exact binary coefficients and combines their exponents. */
function multiply(
  left: PolygonExactNumber,
  right: PolygonExactNumber,
): PolygonExactNumber {
  return {
    coefficient: left.coefficient * right.coefficient,
    exponent: left.exponent + right.exponent,
  };
}

/** Returns only the ordering sign of two exact values. */
function compare(left: PolygonExactNumber, right: PolygonExactNumber): number {
  const difference = subtract(left, right).coefficient;
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}
