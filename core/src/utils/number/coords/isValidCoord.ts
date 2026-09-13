import type { Coord } from "../../../interfaces/Coord.js";

import { ErrorDefinitions } from "../../errors/ErrorDefinitions.js";
import { ReverieTypeError } from "../../errors/ReverieErrors.js";

/** Coordinate fields validated by {@link isValidCoord}. */
const COORD_KEYS = ["x", "y"] as const;

/**
 * Validates the runtime types and numeric safety of a coordinate.
 *
 * This function distinguishes type errors from numeric safety failures: it
 * throws when a component is not a number, and returns `false` for numbers such
 * as fractions, infinities, and values outside the safe-integer range.
 *
 * @param coord - The coordinate to validate before integer-based processing.
 * @returns Whether both coordinate components are safe integers.
 * @throws {ReverieTypeError} Either coordinate component is not a number.
 */
export function isValidCoord(coord: Coord): boolean {
  for (const key of COORD_KEYS) {
    const value = coord[key];

    if (typeof value !== "number") {
      throw ReverieTypeError.from(
        ErrorDefinitions.COMMON.INVALID_COORDINATE_TYPE,
        {
          param: key,
          expected: "number",
          received: typeof value,
        },
      );
    }
  }

  return Number.isSafeInteger(coord.x) && Number.isSafeInteger(coord.y);
}
