import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

/**
 * Copies a canonical sample, including its nested position, so a pipeline stage
 * never shares mutable position data with its input.
 *
 * @param sample - Canonical sample to copy.
 * @returns A new sample with independent position storage.
 */
export function copyStrokeSample(sample: StrokeSample): StrokeSample {
  return {
    position: { ...sample.position },
    timestamp: sample.timestamp,
    pressure: sample.pressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
  };
}
