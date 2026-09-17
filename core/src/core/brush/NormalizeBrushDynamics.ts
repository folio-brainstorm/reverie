import type { BrushDynamics } from "../../interfaces/brush/dynamics/BrushDynamics.js";
import type { BrushParameterDynamics } from "../../interfaces/brush/dynamics/BrushParameterDynamics.js";
import type { DynamicsCurve } from "../../interfaces/brush/dynamics/DynamicsCurve.js";
import type {
  NormalizedBrushDynamics,
  NormalizedBrushParameterDynamics,
  NormalizedScalarDynamics,
  NormalizedVelocityDynamics,
} from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { PressureDynamics } from "../../interfaces/brush/dynamics/PressureDynamics.js";
import type { RotationDynamics } from "../../interfaces/brush/dynamics/RotationDynamics.js";
import type { VelocityDynamics } from "../../interfaces/brush/dynamics/VelocityDynamics.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { LinearDynamicsCurve } from "./LinearDynamicsCurve.js";

const DEFAULT_MINIMUM_RATIO = 0;
const DEFAULT_CURVE: DynamicsCurve = Object.freeze(new LinearDynamicsCurve());
const EMPTY_PARAMETER_DYNAMICS: NormalizedBrushParameterDynamics =
  Object.freeze({ pressure: null, velocity: null });

/**
 * Validates and normalizes optional per-brush dynamics once at construction.
 *
 * @param dynamics - Public dynamics configuration supplied to a brush.
 * @returns Immutable normalized mappings, or `null` when no mapping is enabled.
 * @throws {ReverieRangeError} A dynamics object, marker, ratio, velocity, or curve is invalid.
 */
export function normalizeBrushDynamics(
  dynamics: BrushDynamics | undefined,
): NormalizedBrushDynamics | null {
  if (dynamics === undefined) {
    return null;
  }

  assertObject(dynamics, "dynamics");

  const size = normalizeParameterDynamics(dynamics.size, "dynamics.size");
  const opacity = normalizeParameterDynamics(
    dynamics.opacity,
    "dynamics.opacity",
  );
  const rotation = normalizeRotationDynamics(
    dynamics.rotation,
    "dynamics.rotation",
  );
  const hasScalarDynamics =
    size.pressure !== null ||
    size.velocity !== null ||
    opacity.pressure !== null ||
    opacity.velocity !== null;

  if (
    !hasScalarDynamics &&
    !rotation.hasDirectionRotation &&
    !rotation.hasTiltRotation
  ) {
    return null;
  }

  return Object.freeze({ size, opacity, ...rotation });
}

/** Normalizes the pressure and velocity mappings for one scalar parameter. */
function normalizeParameterDynamics(
  dynamics: BrushParameterDynamics | undefined,
  parameterName: string,
): NormalizedBrushParameterDynamics {
  if (dynamics === undefined) {
    return EMPTY_PARAMETER_DYNAMICS;
  }

  assertObject(dynamics, parameterName);

  const pressure =
    dynamics.pressure === undefined
      ? null
      : normalizePressureDynamics(
          dynamics.pressure,
          `${parameterName}.pressure`,
        );
  const velocity =
    dynamics.velocity === undefined
      ? null
      : normalizeVelocityDynamics(
          dynamics.velocity,
          `${parameterName}.velocity`,
        );

  if (pressure === null && velocity === null) {
    return EMPTY_PARAMETER_DYNAMICS;
  }

  return Object.freeze({ pressure, velocity });
}

/** Normalizes one pressure mapping and fills its stable defaults. */
function normalizePressureDynamics(
  dynamics: PressureDynamics,
  parameterName: string,
): NormalizedScalarDynamics {
  assertObject(dynamics, parameterName);

  return Object.freeze({
    min: normalizeMinimum(dynamics.min, parameterName),
    curve: normalizeCurve(dynamics.curve, parameterName),
  });
}

/** Normalizes one inverse-velocity mapping and fills its stable defaults. */
function normalizeVelocityDynamics(
  dynamics: VelocityDynamics,
  parameterName: string,
): NormalizedVelocityDynamics {
  assertObject(dynamics, parameterName);

  if (
    typeof dynamics.maxVelocity !== "number" ||
    !Number.isFinite(dynamics.maxVelocity) ||
    dynamics.maxVelocity <= 0
  ) {
    throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_MAX_VELOCITY, {
      param: parameterName,
    });
  }

  return Object.freeze({
    min: normalizeMinimum(dynamics.min, parameterName),
    maxVelocity: dynamics.maxVelocity,
    curve: normalizeCurve(dynamics.curve, parameterName),
  });
}

/** Validates rotation markers and reports which contributions are enabled. */
function normalizeRotationDynamics(
  dynamics: RotationDynamics | undefined,
  parameterName: string,
): Pick<NormalizedBrushDynamics, "hasDirectionRotation" | "hasTiltRotation"> {
  if (dynamics === undefined) {
    return { hasDirectionRotation: false, hasTiltRotation: false };
  }

  assertObject(dynamics, parameterName);

  if (dynamics.direction !== undefined) {
    assertObject(dynamics.direction, `${parameterName}.direction`);
  }

  if (dynamics.tilt !== undefined) {
    assertObject(dynamics.tilt, `${parameterName}.tilt`);
  }

  return {
    hasDirectionRotation: dynamics.direction !== undefined,
    hasTiltRotation: dynamics.tilt !== undefined,
  };
}

/** Validates a mapping's minimum ratio and supplies the zero default. */
function normalizeMinimum(
  minimum: number | undefined,
  parameterName: string,
): number {
  const resolvedMinimum = minimum ?? DEFAULT_MINIMUM_RATIO;

  if (!isUnitInterval(resolvedMinimum)) {
    throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_DYNAMICS_MIN, {
      param: parameterName,
    });
  }

  return resolvedMinimum;
}

/** Validates a custom curve or supplies the shared built-in linear curve. */
function normalizeCurve(
  curve: DynamicsCurve | undefined,
  parameterName: string,
): DynamicsCurve {
  if (curve === undefined) {
    return DEFAULT_CURVE;
  }

  if (
    typeof curve !== "object" ||
    curve === null ||
    Array.isArray(curve) ||
    typeof curve.evaluate !== "function"
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_DYNAMICS_CURVE,
      { param: parameterName },
    );
  }

  return curve;
}

/** Rejects malformed nested configuration before reading its properties. */
function assertObject(
  value: unknown,
  parameterName: string,
): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_DYNAMICS_OBJECT,
      { param: parameterName },
    );
  }
}
