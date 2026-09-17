import type { BrushJitter } from "../../interfaces/brush/jitter/BrushJitter.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";

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

  const rotation = resolveAmplitude(jitter.rotation, "jitter.rotation");
  const size = resolveAmplitude(jitter.size, "jitter.size");
  const opacity = resolveAmplitude(jitter.opacity, "jitter.opacity");

  if (rotation === 0 && size === 0 && opacity === 0) {
    return null;
  }

  return Object.freeze({ rotation, size, opacity });
}

/** Rejects negative, nonnumeric, or non-finite configured amplitudes. */
function resolveAmplitude(value: unknown, parameterName: string): number {
  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_JITTER_AMPLITUDE,
      {
        param: parameterName,
      },
    );
  }

  return value;
}
