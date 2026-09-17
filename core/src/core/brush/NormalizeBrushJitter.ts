import type { BrushJitter } from "../../interfaces/brush/jitter/BrushJitter.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { resolveNonnegativeFiniteAmplitude } from "../../utils/number/math/ResolveNonnegativeFiniteAmplitude.js";

/**
 * Validates optional jitter once and captures independent immutable amplitudes.
 *
 * @param jitter - Optional angular and scalar variation configuration.
 * @returns Owned amplitudes, or `null` when all variation is disabled.
 * @throws {ReverieRangeError} Configuration is malformed or an amplitude is invalid.
 */
export function normalizeBrushJitter(
  jitter: BrushJitter | undefined,
): NormalizedBrushJitter | null {
  if (jitter === undefined) {
    return null;
  }

  if (typeof jitter !== "object" || jitter === null || Array.isArray(jitter)) {
    throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_JITTER_OBJECT);
  }

  const rotation = resolveNonnegativeFiniteAmplitude(
    jitter.rotation,
    "jitter.rotation",
    createInvalidAmplitudeError,
  );
  const size = resolveNonnegativeFiniteAmplitude(
    jitter.size,
    "jitter.size",
    createInvalidAmplitudeError,
  );
  const opacity = resolveNonnegativeFiniteAmplitude(
    jitter.opacity,
    "jitter.opacity",
    createInvalidAmplitudeError,
  );

  if (rotation === 0 && size === 0 && opacity === 0) {
    return null;
  }

  return Object.freeze({ rotation, size, opacity });
}

/** Creates the jitter-specific error for an invalid configured amplitude. */
function createInvalidAmplitudeError(parameterName: string): ReverieRangeError {
  return ReverieRangeError.from(
    ErrorDefinitions.BRUSH.INVALID_JITTER_AMPLITUDE,
    {
      param: parameterName,
    },
  );
}
