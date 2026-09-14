import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";

/**
 * Places evenly spaced points on one linear segment while preserving distance
 * accumulated from earlier segments.
 *
 * @param start - Beginning of the current sample segment.
 * @param end - End of the current sample segment.
 * @param stampDistance - Positive finite distance between adjacent stamps.
 * @param distanceSinceLastStamp - Distance carried from preceding segments.
 * @param placeStamp - Consumer invoked for each newly placed world position.
 * @returns Trailing path distance since the final placed stamp.
 */
export function advanceStampPlacement(
  start: WorldPoint,
  end: WorldPoint,
  stampDistance: number,
  distanceSinceLastStamp: number,
  placeStamp: (position: WorldPoint) => void,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
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
        ? { ...end }
        : {
            x: start.x + deltaX * interpolation,
            y: start.y + deltaY * interpolation,
          },
    );

    lastStampDistance = clampedDistance;
    distanceAlongSegment += stampDistance;
  }

  const trailingDistance = segmentLength - lastStampDistance;
  return trailingDistance <= tolerance ? 0 : trailingDistance;
}
