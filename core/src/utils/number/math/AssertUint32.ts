import { ErrorDefinitions } from "../../errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../errors/ReverieErrors.js";

/**
 * Rejects values that cannot be represented as an unsigned 32-bit integer.
 *
 * @param value - Seed, stamp index, sequence, or random-channel identifier.
 * @param parameterName - Context identifying the invalid public input.
 * @throws {ReverieRangeError} The value is not an integer in `[0, 0xffffffff]`.
 */
export function assertUint32(
  value: unknown,
  parameterName: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    throw ReverieRangeError.from(ErrorDefinitions.RANDOM.INVALID_UINT32, {
      param: parameterName,
    });
  }
}
