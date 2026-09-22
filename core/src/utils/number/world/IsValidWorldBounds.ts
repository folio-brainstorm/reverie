import type { WorldBounds } from "../../../interfaces/world/WorldBounds.js";

/**
 * Determines whether a value describes a finite, half-open World pixel region.
 *
 * @param value - Candidate region with world-pixel origin and dimensions.
 * @returns Whether every component is safe and the final covered pixel is safe.
 */
export function isValidWorldBounds(value: unknown): value is WorldBounds {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (
    !("x" in value) ||
    !("y" in value) ||
    !("width" in value) ||
    !("height" in value)
  ) {
    return false;
  }

  const { x, y, width, height } = value;
  const hasValidComponents =
    typeof x === "number" &&
    Number.isSafeInteger(x) &&
    typeof y === "number" &&
    Number.isSafeInteger(y) &&
    typeof width === "number" &&
    Number.isSafeInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isSafeInteger(height) &&
    height > 0;
  if (!hasValidComponents) {
    return false;
  }

  return (
    !exceedsSafeFinalCoordinate(x, width) &&
    !exceedsSafeFinalCoordinate(y, height)
  );
}

/** Tests whether a positive half-open dimension exceeds safe pixel coordinates. */
function exceedsSafeFinalCoordinate(origin: number, dimension: number): boolean {
  return (
    origin > 0 && dimension - 1 > Number.MAX_SAFE_INTEGER - origin
  );
}
