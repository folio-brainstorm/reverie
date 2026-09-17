import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { DynamicsCurve } from "../../interfaces/brush/dynamics/DynamicsCurve.js";
import type {
  NormalizedBrushDynamics,
  NormalizedBrushParameterDynamics,
  NormalizedScalarDynamics,
  NormalizedVelocityDynamics,
} from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";

import {
  DEFAULT_PRESSURE,
  DEFAULT_TILT_X,
  DEFAULT_TILT_Y,
  MAX_TILT_DEGREES,
  MIN_TILT_DEGREES,
} from "../../config/stroke/StrokeInputConstants.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";

const DEFAULT_VELOCITY = 0;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Resolves immutable brush baselines against one actual stamp's input.
 *
 * @param baseSize - Validated positive brush diameter in world units.
 * @param baseOpacity - Validated base opacity in the inclusive range `[0, 1]`.
 * @param baseRotation - Validated static rotation offset in radians.
 * @param dynamics - Validated mappings captured by the brush constructor.
 * @param input - Optional stamp input; omitted values use neutral Core defaults.
 * @returns Size, opacity, and rotation resolved for this stamp only.
 * @throws {ReverieRangeError} Used input, curve output, or final values are invalid.
 */
export function resolveBrushDynamics(
  baseSize: number,
  baseOpacity: number,
  baseRotation: number,
  dynamics: NormalizedBrushDynamics | null,
  input?: StampCommand,
): ResolvedBrushParameters {
  if (dynamics === null) {
    return { size: baseSize, opacity: baseOpacity, rotation: baseRotation };
  }

  const sizeFactor = resolveParameterFactor(
    dynamics.size,
    input,
    "dynamics.size",
  );
  const opacityFactor = resolveParameterFactor(
    dynamics.opacity,
    input,
    "dynamics.opacity",
  );
  const resolved = {
    size: baseSize * sizeFactor,
    opacity: baseOpacity * opacityFactor,
    rotation:
      baseRotation +
      (dynamics.hasDirectionRotation ? resolveDirectionRotation(input) : 0) +
      (dynamics.hasTiltRotation ? resolveTiltRotation(input) : 0),
  };

  if (
    !Number.isFinite(resolved.size) ||
    resolved.size < 0 ||
    !isUnitInterval(resolved.opacity) ||
    !Number.isFinite(resolved.rotation)
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_RESOLVED_PARAMETERS,
    );
  }

  return resolved;
}

/** Resolves an optional finite path direction to its additive angle. */
function resolveDirectionRotation(input: StampCommand | undefined): number {
  const direction = input?.direction;

  if (direction === undefined) {
    return 0;
  }

  if (typeof direction !== "number" || !Number.isFinite(direction)) {
    throwInvalidInput("dynamics.rotation.direction.input");
  }

  return direction;
}

/** Multiplies every enabled normalized factor for one scalar parameter. */
function resolveParameterFactor(
  dynamics: NormalizedBrushParameterDynamics,
  input: StampCommand | undefined,
  parameterName: string,
): number {
  let factor = 1;

  if (dynamics.pressure !== null) {
    factor *= resolvePressureFactor(
      dynamics.pressure,
      input?.pressure ?? DEFAULT_PRESSURE,
      `${parameterName}.pressure`,
    );
  }

  if (dynamics.velocity !== null) {
    factor *= resolveVelocityFactor(
      dynamics.velocity,
      input?.velocity ?? DEFAULT_VELOCITY,
      `${parameterName}.velocity`,
    );
  }

  return factor;
}

/** Maps normalized pressure from its configured minimum to the base side. */
function resolvePressureFactor(
  dynamics: NormalizedScalarDynamics,
  pressure: number,
  parameterName: string,
): number {
  if (!isUnitInterval(pressure)) {
    throwInvalidInput(`${parameterName}.input`);
  }

  return interpolateFactor(
    dynamics.min,
    evaluateCurve(dynamics.curve, pressure, parameterName),
  );
}

/** Normalizes and inverts velocity before applying its configured curve. */
function resolveVelocityFactor(
  dynamics: NormalizedVelocityDynamics,
  velocity: number,
  parameterName: string,
): number {
  if (
    typeof velocity !== "number" ||
    !Number.isFinite(velocity) ||
    velocity < 0
  ) {
    throwInvalidInput(`${parameterName}.input`);
  }

  const normalizedVelocity = Math.min(velocity / dynamics.maxVelocity, 1);
  const curveInput = 1 - normalizedVelocity;

  return interpolateFactor(
    dynamics.min,
    evaluateCurve(dynamics.curve, curveInput, parameterName),
  );
}

/** Evaluates a curve and rejects every non-normalized response. */
function evaluateCurve(
  curve: DynamicsCurve,
  input: number,
  parameterName: string,
): number {
  const output = curve.evaluate(input);

  if (!isUnitInterval(output)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_DYNAMICS_CURVE_OUTPUT,
      { param: parameterName, received: output },
    );
  }

  return output;
}

/** Interpolates a normalized curve response between a minimum and one. */
function interpolateFactor(minimum: number, response: number): number {
  return minimum + (1 - minimum) * response;
}

/** Converts the pen-axis projection into a deterministic radian orientation. */
function resolveTiltRotation(input: StampCommand | undefined): number {
  const tiltX = input?.tiltX ?? DEFAULT_TILT_X;
  const tiltY = input?.tiltY ?? DEFAULT_TILT_Y;

  assertValidTilt(tiltX, "tiltX");
  assertValidTilt(tiltY, "tiltY");

  if (tiltX === 0 && tiltY === 0) {
    return 0;
  }

  return Math.atan2(
    Math.tan(tiltY * DEGREES_TO_RADIANS),
    Math.tan(tiltX * DEGREES_TO_RADIANS),
  );
}

/** Rejects an invalid tilt component used by rotation dynamics. */
function assertValidTilt(tilt: number, parameterName: string): void {
  if (
    typeof tilt !== "number" ||
    !Number.isFinite(tilt) ||
    tilt < MIN_TILT_DEGREES ||
    tilt > MAX_TILT_DEGREES
  ) {
    throwInvalidInput(`dynamics.rotation.tilt.${parameterName}`);
  }
}

/** Throws the stable error shared by malformed per-stamp dynamics input. */
function throwInvalidInput(parameterName: string): never {
  throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_DYNAMICS_INPUT, {
    param: parameterName,
  });
}
