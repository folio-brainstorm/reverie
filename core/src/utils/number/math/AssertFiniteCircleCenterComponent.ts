import { ErrorDefinitions } from "../../errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../errors/ReverieErrors.js";

/**
 * Validates one continuous circle-center coordinate at a geometry boundary.
 *
 * @param value - Coordinate supplied by a caller or derived paint geometry.
 * @param parameterName - Diagnostic name for the horizontal or vertical center.
 * @throws {ReverieTypeError} The coordinate is not a number.
 * @throws {ReverieRangeError} The coordinate is not finite.
 */
export function assertFiniteCircleCenterComponent(
  value: unknown,
  parameterName: "center.x" | "center.y",
): asserts value is number {
  if (typeof value !== "number") {
    throw ReverieTypeError.from(
      ErrorDefinitions.COMMON.INVALID_COORDINATE_TYPE,
      {
        param: parameterName,
        expected: "number",
        received: typeof value,
      },
    );
  }

  if (!Number.isFinite(value)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.COMMON.INVALID_CIRCLE_CENTER,
      {
        param: parameterName,
        received: value,
      },
    );
  }
}
