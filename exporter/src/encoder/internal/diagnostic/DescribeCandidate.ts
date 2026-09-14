/**
 * Describes a rejected value for an error message without dumping it.
 *
 * Objects and arrays collapse to `"object"`, so the description stays short
 * even when the rejected value is large or self-referential.
 *
 * @param value - Rejected candidate value.
 * @returns `"null"` for `null`, otherwise the value's `typeof` tag.
 *
 * @example
 * describeCandidate(undefined); // => "undefined"
 * describeCandidate(null); // => "null"
 */
export function describeCandidate(value: unknown): string {
  return value === null ? "null" : typeof value;
}
