import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

import { copyStrokeSample } from "./CopyStrokeSample.js";
import { interpolateStrokeSample } from "./InterpolateStrokeSample.js";

/**
 * Emits fixed-distance samples along a streaming piecewise-linear path.
 *
 * Distance not consumed on one segment carries into the next segment. The
 * resampler owns independent state from brush stamp placement.
 */
export class StrokeResampler {
  /** Most recent smoothed input, including zero-length inputs. */
  private lastInputSample: StrokeSample | null = null;

  /** Path distance accumulated after the most recent emitted sample. */
  private distanceSinceLastOutput = 0;

  /**
   * Creates an empty resampler with a validated fixed world-space interval.
   *
   * @param distance - Positive finite distance between processed samples.
   */
  constructor(private readonly distance: number) {}

  /**
   * Consumes one smoothed sample and visits each newly resampled output.
   *
   * The first sample is always emitted. Position, timestamp, pressure, and both
   * tilt axes are linearly interpolated for later outputs, and zero-length
   * segments emit nothing.
   *
   * @param sample - Current smoothed input sample.
   * @param visit - Synchronous consumer invoked once per processed sample.
   */
  push(sample: StrokeSample, visit: (sample: StrokeSample) => void): void {
    const previousSample = this.lastInputSample;
    this.lastInputSample = sample;

    if (previousSample === null) {
      visit(copyStrokeSample(sample));
      return;
    }

    const deltaX = sample.position.x - previousSample.position.x;
    const deltaY = sample.position.y - previousSample.position.y;
    const segmentLength = Math.hypot(deltaX, deltaY);

    if (segmentLength === 0) {
      return;
    }

    const tolerance = Number.EPSILON * Math.max(1, this.distance) * 16;
    const distanceToFirstOutput = this.distance - this.distanceSinceLastOutput;

    if (distanceToFirstOutput > segmentLength + tolerance) {
      this.distanceSinceLastOutput += segmentLength;
      return;
    }

    let distanceAlongSegment = Math.min(distanceToFirstOutput, segmentLength);
    let lastOutputDistance = distanceAlongSegment;

    while (distanceAlongSegment <= segmentLength + tolerance) {
      const clampedDistance = Math.min(distanceAlongSegment, segmentLength);
      const isSegmentEnd = segmentLength - clampedDistance <= tolerance;
      const interpolation = clampedDistance / segmentLength;

      visit(
        isSegmentEnd
          ? copyStrokeSample(sample)
          : interpolateStrokeSample(previousSample, sample, interpolation),
      );

      lastOutputDistance = clampedDistance;
      distanceAlongSegment += this.distance;
    }

    const trailingDistance = segmentLength - lastOutputDistance;
    this.distanceSinceLastOutput =
      trailingDistance <= tolerance ? 0 : trailingDistance;
  }
}
