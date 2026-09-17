import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";

import { STAMP_RANDOM_CHANNELS } from "../../config/random/StampRandomChannels.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { sampleSignedUint32Random } from "../../utils/random/SampleSignedUint32Random.js";

/**
 * Applies isolated deterministic jitter to already resolved dynamics parameters.
 *
 * @param resolved - Validated dynamics result, which remains unchanged.
 * @param jitter - Validated immutable amplitudes, or `null` when disabled.
 * @param brushSeed - Validated uint32 base seed used by direct legacy stamps.
 * @param input - Optional final stroke seed and stroke-local stamp identity.
 * @returns Final finite parameters with nonnegative size and opacity in `[0, 1]`.
 * @throws {ReverieRangeError} Used identity is invalid or arithmetic overflows.
 */
export function resolveBrushJitter(
  resolved: ResolvedBrushParameters,
  jitter: NormalizedBrushJitter | null,
  brushSeed: number,
  input?: StampCommand,
): ResolvedBrushParameters {
  if (jitter === null) {
    return resolved;
  }

  // Missing identity uses a fixed stamp rather than hidden invocation state.
  const strokeSeed =
    input?.strokeSeed === undefined ? brushSeed : input.strokeSeed;
  const stampIndex = input?.stampIndex === undefined ? 0 : input.stampIndex;
  assertUint32(strokeSeed, "stamp.strokeSeed");
  assertUint32(stampIndex, "stamp.stampIndex");

  const size =
    jitter.size === 0
      ? resolved.size
      : resolved.size *
        (1 +
          sampleSignedUint32Random(
            strokeSeed,
            stampIndex,
            STAMP_RANDOM_CHANNELS.size,
          ) *
            jitter.size);
  const opacity =
    jitter.opacity === 0
      ? resolved.opacity
      : resolved.opacity *
        (1 +
          sampleSignedUint32Random(
            strokeSeed,
            stampIndex,
            STAMP_RANDOM_CHANNELS.opacity,
          ) *
            jitter.opacity);
  const rotation =
    jitter.rotation === 0
      ? resolved.rotation
      : resolved.rotation +
        sampleSignedUint32Random(
          strokeSeed,
          stampIndex,
          STAMP_RANDOM_CHANNELS.rotation,
        ) *
          jitter.rotation;

  // Reject overflow before clamping so Infinity cannot silently become valid paint.
  if (
    !Number.isFinite(size) ||
    !Number.isFinite(opacity) ||
    !Number.isFinite(rotation)
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_JITTER_PARAMETERS,
    );
  }

  return {
    size: Math.max(0, size),
    opacity: Math.max(0, Math.min(1, opacity)),
    rotation,
  };
}
