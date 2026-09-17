import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";

import { STAMP_RANDOM_CHANNELS } from "../../config/random/StampRandomChannels.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { sampleSignedUint32Random } from "../../utils/random/SampleSignedUint32Random.js";

/** Smallest ratio used when spacing jitter would otherwise reverse progress. */
const MINIMUM_SPACING_MULTIPLIER = 0.000001;

/**
 * Resolves the world-space interval owned by one emitted stamp.
 *
 * A zero resolved size represents a paint no-op, so it deliberately falls
 * back to the brush's base interval. This preserves progress without making
 * a zero-size dynamics result create an unbounded placement loop.
 *
 * @param resolvedSize - Final dynamics and size-jitter-adjusted stamp size.
 * @param size - Immutable positive brush size used for the zero-size fallback.
 * @param spacing - Immutable positive brush spacing ratio.
 * @param jitter - Validated brush variation settings, if variation is enabled.
 * @param strokeSeed - Stable seed shared by this stroke.
 * @param input - Stamp identity that owns the outgoing interval.
 * @returns A finite positive world-space distance to the following stamp.
 * @throws {ReverieRangeError} Size or interval arithmetic is invalid or overflows.
 */
export function resolveBrushStampDistance(
  resolvedSize: number,
  size: number,
  spacing: number,
  jitter: NormalizedBrushJitter | null,
  strokeSeed: number,
  input: StampCommand,
): number {
  const fallbackDistance = size * spacing;

  if (
    !Number.isFinite(resolvedSize) ||
    resolvedSize < 0 ||
    !Number.isFinite(fallbackDistance) ||
    fallbackDistance <= 0
  ) {
    throwInvalidResolvedSpacing();
  }

  if (resolvedSize === 0) {
    return fallbackDistance;
  }

  const baseDistance = resolvedSize * spacing;

  if (!Number.isFinite(baseDistance) || baseDistance <= 0) {
    throwInvalidResolvedSpacing();
  }

  if (jitter === null || jitter.spacing === 0) {
    return baseDistance;
  }

  const stampIndex = input.stampIndex === undefined ? 0 : input.stampIndex;
  const multiplier =
    1 +
    sampleSignedUint32Random(
      strokeSeed,
      stampIndex,
      STAMP_RANDOM_CHANNELS.spacing,
    ) *
      jitter.spacing;

  if (!Number.isFinite(multiplier)) {
    throwInvalidResolvedSpacing();
  }

  if (multiplier <= 0) {
    return Math.max(Number.MIN_VALUE, baseDistance * MINIMUM_SPACING_MULTIPLIER);
  }

  const distance = baseDistance * multiplier;

  if (!Number.isFinite(distance) || distance <= 0) {
    throwInvalidResolvedSpacing();
  }

  return distance;
}

/** Throws the stable error for invalid final stamp-placement math. */
function throwInvalidResolvedSpacing(): never {
  throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_RESOLVED_SPACING);
}
