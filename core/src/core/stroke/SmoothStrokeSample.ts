import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

/**
 * Applies one streaming exponential moving average step to sample position.
 *
 * The first input is copied unchanged. Later timestamps always come from the
 * current input because smoothing affects only spatial position.
 *
 * @param previous - Previous smoothed sample, or `null` for the first input.
 * @param current - Current raw input sample.
 * @param factor - Validated smoothing factor in the range `(0, 1]`.
 * @returns A newly owned smoothed sample.
 */
export function smoothStrokeSample(
  previous: StrokeSample | null,
  current: StrokeSample,
  factor: number,
): StrokeSample {
  if (previous === null) {
    return copySample(current);
  }

  return {
    position: {
      x:
        previous.position.x +
        (current.position.x - previous.position.x) * factor,
      y:
        previous.position.y +
        (current.position.y - previous.position.y) * factor,
    },
    timestamp: current.timestamp,
  };
}

/** Copies a sample so processing never retains caller-owned position data. */
function copySample(sample: StrokeSample): StrokeSample {
  return {
    position: { ...sample.position },
    timestamp: sample.timestamp,
  };
}
