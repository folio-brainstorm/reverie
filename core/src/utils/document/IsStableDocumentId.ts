/**
 * Reports whether a runtime or serialized document identity is non-empty text.
 *
 * @param value - Candidate identifier supplied by runtime or serialized input.
 * @returns `true` when the identifier is a non-whitespace string.
 */
export function isStableDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
