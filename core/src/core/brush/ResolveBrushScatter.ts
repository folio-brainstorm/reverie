import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushScatter } from "../../interfaces/brush/scatter/NormalizedBrushScatter.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";

import { STAMP_RANDOM_CHANNELS } from "../../config/random/StampRandomChannels.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { sampleSignedUint32Random } from "../../utils/random/SampleSignedUint32Random.js";

/**
 * Resolves a final paint position from the original stamp geometry and scatter.
 *
 * @param position - Original unmodified world-space stamp position.
 * @param resolved - Final dynamics and jitter parameters; size scales scatter.
 * @param scatter - Validated immutable scatter amplitudes, or `null` when disabled.
 * @param brushSeed - Validated uint32 base seed used by direct legacy stamps.
 * @param input - Optional final stroke seed, stamp index, and direction.
 * @returns Original position when disabled, otherwise a finite scattered paint position.
 * @throws {ReverieRangeError} Used identity, direction, offset, or final position is invalid.
 */
export function resolveBrushScatter(
  position: WorldPoint,
  resolved: ResolvedBrushParameters,
  scatter: NormalizedBrushScatter | null,
  brushSeed: number,
  input?: StampCommand,
): WorldPoint {
  if (scatter === null) {
    return position;
  }

  const strokeSeed =
    input?.strokeSeed === undefined ? brushSeed : input.strokeSeed;
  const stampIndex = input?.stampIndex === undefined ? 0 : input.stampIndex;
  assertUint32(strokeSeed, "stamp.strokeSeed");
  assertUint32(stampIndex, "stamp.stampIndex");

  const direction = input?.direction === undefined ? 0 : input.direction;
  if (typeof direction !== "number" || !Number.isFinite(direction)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_SCATTER_DIRECTION,
    );
  }

  const alongOffset = resolveAxisOffset(
    strokeSeed,
    stampIndex,
    STAMP_RANDOM_CHANNELS.scatterAlong,
    resolved.size,
    scatter.along,
  );
  const acrossOffset = resolveAxisOffset(
    strokeSeed,
    stampIndex,
    STAMP_RANDOM_CHANNELS.scatterAcross,
    resolved.size,
    scatter.across,
  );

  assertFinitePosition(alongOffset, "offset.along");
  assertFinitePosition(acrossOffset, "offset.across");

  const cosine = Math.cos(direction);
  const sine = Math.sin(direction);
  const x = position.x + cosine * alongOffset - sine * acrossOffset;
  const y = position.y + sine * alongOffset + cosine * acrossOffset;
  assertFinitePosition(x, "final position.x");
  assertFinitePosition(y, "final position.y");
  return { x, y };
}

/** Resolves one size-relative along-path or across-path scatter offset. */
function resolveAxisOffset(
  strokeSeed: number,
  stampIndex: number,
  channel: number,
  size: number,
  amplitude: number,
): number {
  if (amplitude === 0) {
    return 0;
  }

  return (
    sampleSignedUint32Random(strokeSeed, stampIndex, channel) * size * amplitude
  );
}

/** Rejects a non-finite final scattered coordinate before it reaches a paint path. */
function assertFinitePosition(
  value: unknown,
  parameterName: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_SCATTER_RESULT,
      { param: parameterName },
    );
  }
}
