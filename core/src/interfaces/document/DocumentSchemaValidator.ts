/** Validates and normalizes one exact serialized document schema version. */
export interface DocumentSchemaValidator {
  /** Exact schema version accepted by this validator. */
  readonly version: number;

  /**
   * Validates one isolated schema value and returns normalized serialized data.
   *
   * @param input - Candidate serialized document for `version`.
   * @returns Normalized data trusted by the next migration step or caller.
   * @throws {Error} The candidate does not satisfy this exact source schema.
   */
  validate(input: unknown): unknown;
}
