import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

/**
 * Calculates world-space speed between adjacent actual stamp samples.
 *
 * @param previous - Previously placed stamp sample, or `null` for the first stamp.
 * @param current - Current placed stamp sample.
 * @returns Finite world units per millisecond, using `0` when no usable delta exists.
 */
export function deriveStampVelocity(
  previous: StrokeSample | null,
  current: StrokeSample,
): number {
  if (previous === null) {
    return 0;
  }

  const deltaTime = current.timestamp - previous.timestamp;

  if (deltaTime <= 0) {
    return 0;
  }

  const distance = Math.hypot(
    current.position.x - previous.position.x,
    current.position.y - previous.position.y,
  );
  const velocity = distance / deltaTime;

  return Number.isFinite(velocity) ? velocity : Number.MAX_VALUE;
}
