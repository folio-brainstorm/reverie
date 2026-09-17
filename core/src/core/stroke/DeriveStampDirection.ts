import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

/**
 * Calculates the world-space angle between adjacent actual stamp positions.
 *
 * @param previous - Previously placed stamp sample, or `null` for the first stamp.
 * @param current - Current placed stamp sample.
 * @returns Direction in radians, or `undefined` when no displacement exists.
 */
export function deriveStampDirection(
  previous: StrokeSample | null,
  current: StrokeSample,
): number | undefined {
  if (previous === null) {
    return undefined;
  }

  const deltaX = current.position.x - previous.position.x;
  const deltaY = current.position.y - previous.position.y;

  if (deltaX === 0 && deltaY === 0) {
    return undefined;
  }

  const direction = Math.atan2(deltaY, deltaX);
  return Number.isFinite(direction) ? direction : undefined;
}
