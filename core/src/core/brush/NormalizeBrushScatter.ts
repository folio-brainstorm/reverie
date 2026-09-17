import type { BrushScatter } from "../../interfaces/brush/scatter/BrushScatter.js";
import type { NormalizedBrushScatter } from "../../interfaces/brush/scatter/NormalizedBrushScatter.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { resolveNonnegativeFiniteAmplitude } from "../../utils/number/math/ResolveNonnegativeFiniteAmplitude.js";

/**
 * Validates optional scatter once and captures immutable size-relative amplitudes.
 *
 * @param scatter - Optional along-path and across-path variation configuration.
 * @returns Owned amplitudes, or `null` when both components are disabled.
 * @throws {ReverieRangeError} Configuration is malformed or an amplitude is invalid.
 */
export function normalizeBrushScatter(
  scatter: BrushScatter | undefined,
): NormalizedBrushScatter | null {
  if (scatter === undefined) {
    return null;
  }

  if (
    typeof scatter !== "object" ||
    scatter === null ||
    Array.isArray(scatter)
  ) {
    throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_SCATTER_OBJECT);
  }

  const along = resolveNonnegativeFiniteAmplitude(
    scatter.along,
    "scatter.along",
    createInvalidAmplitudeError,
  );
  const across = resolveNonnegativeFiniteAmplitude(
    scatter.across,
    "scatter.across",
    createInvalidAmplitudeError,
  );

  if (along === 0 && across === 0) {
    return null;
  }

  return Object.freeze({ along, across });
}

/** Creates the scatter-specific error for an invalid configured amplitude. */
function createInvalidAmplitudeError(parameterName: string): ReverieRangeError {
  return ReverieRangeError.from(
    ErrorDefinitions.BRUSH.INVALID_SCATTER_AMPLITUDE,
    { param: parameterName },
  );
}
