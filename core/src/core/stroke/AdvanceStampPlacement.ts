import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";
import type { StampPlacementState } from "../../interfaces/stroke/StampPlacementState.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { copyStrokeSample } from "./CopyStrokeSample.js";
import { interpolateStrokeSample } from "./InterpolateStrokeSample.js";

/**
 * Places dynamically spaced samples on one linear segment while preserving
 * distance accumulated from earlier segments.
 *
 * Each placed stamp carries the input state interpolated at its own path
 * position rather than either endpoint's snapshot, so callers never observe a
 * discontinuity between adjacent stamps.
 *
 * @param start - Beginning of the current sample segment.
 * @param end - End of the current sample segment.
 * @param nextStampDistance - Positive finite interval owned by the preceding stamp.
 * @param distanceSinceLastStamp - Distance carried from preceding segments.
 * @param placeStamp - Consumer invoked for each newly placed sample; its return
 * value is the interval owned by that newly emitted stamp.
 * @returns Trailing distance and the interval required by the next placement.
 * @throws {ReverieRangeError} Adding a valid interval cannot advance at the
 * current numeric precision.
 */
export function advanceStampPlacement(
  start: StrokeSample,
  end: StrokeSample,
  nextStampDistance: number,
  distanceSinceLastStamp: number,
  placeStamp: (sample: StrokeSample) => number,
): StampPlacementState {
  const deltaX = end.position.x - start.position.x;
  const deltaY = end.position.y - start.position.y;
  const segmentLength = Math.hypot(deltaX, deltaY);

  if (segmentLength === 0) {
    return { distanceSinceLastStamp, nextStampDistance };
  }

  const tolerance = Number.EPSILON * Math.max(1, nextStampDistance) * 16;
  const distanceToFirstStamp = nextStampDistance - distanceSinceLastStamp;

  if (distanceToFirstStamp > segmentLength + tolerance) {
    return {
      distanceSinceLastStamp: distanceSinceLastStamp + segmentLength,
      nextStampDistance,
    };
  }

  let distanceAlongSegment = Math.min(distanceToFirstStamp, segmentLength);
  let lastStampDistance = distanceAlongSegment;
  let activeStampDistance = nextStampDistance;

  while (distanceAlongSegment <= segmentLength + tolerance) {
    const clampedDistance = Math.min(distanceAlongSegment, segmentLength);
    const isSegmentEnd = segmentLength - clampedDistance <= tolerance;
    const interpolation = clampedDistance / segmentLength;

    activeStampDistance = placeStamp(
      isSegmentEnd
        ? copyStrokeSample(end)
        : interpolateStrokeSample(start, end, interpolation),
    );

    lastStampDistance = clampedDistance;
    const nextDistanceAlongSegment =
      distanceAlongSegment + activeStampDistance;

    if (nextDistanceAlongSegment <= distanceAlongSegment) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.STAMP_PLACEMENT_NO_PROGRESS,
      );
    }

    distanceAlongSegment = nextDistanceAlongSegment;
  }

  const trailingDistance = segmentLength - lastStampDistance;
  return {
    distanceSinceLastStamp: trailingDistance <= tolerance ? 0 : trailingDistance,
    nextStampDistance: activeStampDistance,
  };
}
