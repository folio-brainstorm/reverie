import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";
import type { StrokeSampleInput } from "../../interfaces/stroke/StrokeSampleInput.js";

import {
  DEFAULT_PRESSURE,
  DEFAULT_TILT_X,
  DEFAULT_TILT_Y,
} from "../../config/stroke/StrokeInputConstants.js";

/**
 * Converts validated public stroke input into a complete canonical sample.
 *
 * Missing optional attributes fall back to their Core defaults, and the nested
 * position is copied, so the returned sample never aliases caller state.
 *
 * @param input - Stroke input already validated at the stroke boundary.
 * @returns A canonical sample carrying every input attribute.
 */
export function normalizeStrokeSample(input: StrokeSampleInput): StrokeSample {
  return {
    position: { ...input.position },
    timestamp: input.timestamp,
    pressure: input.pressure ?? DEFAULT_PRESSURE,
    tiltX: input.tiltX ?? DEFAULT_TILT_X,
    tiltY: input.tiltY ?? DEFAULT_TILT_Y,
  };
}
