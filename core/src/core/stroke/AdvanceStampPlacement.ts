import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

import { copyStrokeSample } from "./CopyStrokeSample.js";
import { interpolateStrokeSample } from "./InterpolateStrokeSample.js";

/**
 * Places evenly spaced samples on one linear segment while preserving distance
 * accumulated from earlier segments.
 *
 * Each placed stamp carries the input state interpolated at its own path
 * position rather than either endpoint's snapshot, so callers never observe a
 * discontinuity between adjacent stamps.
 *
 * @param start - Beginning of the current sample segment.
 * @param end - End of the current sample segment.
 * @param stampDistance - Positive finite distance between adjacent stamps.
 * @param distanceSinceLastStamp - Distance carried from preceding segments.
 * @param placeStamp - Consumer invoked for each newly placed sample.
 * @returns Trailing path distance since the final placed stamp.
 */
export function advanceStampPlacement(
  start: StrokeSample,
  end: StrokeSample,
  stampDistance: number,
  distanceSinceLastStamp: number,
  placeStamp: (sample: StrokeSample) => void,
): number {
  const deltaX = end.position.x - start.position.x;
  const deltaY = end.position.y - start.position.y;
  const segmentLength = Math.hypot(deltaX, deltaY);

  if (segmentLength === 0) {
    return distanceSinceLastStamp;
  }

  const tolerance = Number.EPSILON * Math.max(1, stampDistance) * 16;
  const distanceToFirstStamp = stampDistance - distanceSinceLastStamp;

  if (distanceToFirstStamp > segmentLength + tolerance) {
    return distanceSinceLastStamp + segmentLength;
  }

  let distanceAlongSegment = Math.min(distanceToFirstStamp, segmentLength);
  let lastStampDistance = distanceAlongSegment;

  while (distanceAlongSegment <= segmentLength + tolerance) {
    const clampedDistance = Math.min(distanceAlongSegment, segmentLength);
    const isSegmentEnd = segmentLength - clampedDistance <= tolerance;
    const interpolation = clampedDistance / segmentLength;

    placeStamp(
      isSegmentEnd
        ? copyStrokeSample(end)
        : interpolateStrokeSample(start, end, interpolation),
    );

    lastStampDistance = clampedDistance;
    distanceAlongSegment += stampDistance;
  }

  const trailingDistance = segmentLength - lastStampDistance;
  return trailingDistance <= tolerance ? 0 : trailingDistance;
}
