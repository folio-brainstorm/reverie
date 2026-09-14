import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

import { copyStrokeSample } from "./CopyStrokeSample.js";

/**
 * Applies one streaming exponential moving average step to sample position.
 *
 * The first input is copied unchanged. Later timestamps and the extended input
 * attributes always come from the current input because Step 17 smooths only
 * spatial position.
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
    return copyStrokeSample(current);
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
    pressure: current.pressure,
    tiltX: current.tiltX,
    tiltY: current.tiltY,
  };
}
