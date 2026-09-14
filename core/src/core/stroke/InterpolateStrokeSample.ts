import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

/**
 * Linearly interpolates every canonical attribute between two samples.
 *
 * All five attributes use the same parameter, so a derived sample always
 * describes one consistent point along the path.
 *
 * Position deliberately uses the delta form already used by path resampling and
 * stamp placement, which keeps generated stamp positions bit-for-bit identical
 * to earlier releases. Scalar attributes use the symmetric form already used
 * for timestamps, which avoids overflowing an intermediate delta.
 *
 * @param start - Sample at the beginning of the segment.
 * @param end - Sample at the end of the segment.
 * @param amount - Interpolation weight, where `0` yields `start` and `1` yields `end`.
 * @returns A newly owned sample combining both endpoints.
 */
export function interpolateStrokeSample(
  start: StrokeSample,
  end: StrokeSample,
  amount: number,
): StrokeSample {
  return {
    position: {
      x: interpolatePosition(start.position.x, end.position.x, amount),
      y: interpolatePosition(start.position.y, end.position.y, amount),
    },
    timestamp: interpolateScalar(start.timestamp, end.timestamp, amount),
    pressure: interpolateScalar(start.pressure, end.pressure, amount),
    tiltX: interpolateScalar(start.tiltX, end.tiltX, amount),
    tiltY: interpolateScalar(start.tiltY, end.tiltY, amount),
  };
}

/** Interpolates a path coordinate using Rêverie's established delta form. */
function interpolatePosition(
  start: number,
  end: number,
  amount: number,
): number {
  return start + (end - start) * amount;
}

/** Interpolates a scalar attribute without overflowing its intermediate delta. */
function interpolateScalar(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}
