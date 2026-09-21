/** One deterministic plain-data transition between adjacent schema revisions. */
export interface DocumentMigration {
  /** Source integer schema revision accepted by this migration. */
  readonly fromVersion: number;

  /** Destination integer schema revision produced by this migration. */
  readonly toVersion: number;

  /**
   * Converts serialized data without reading or mutating runtime World objects.
   *
   * @param input - Independent plain serialized data from the previous revision.
   * @returns Plain serialized data for the destination revision.
   */
  migrate(input: unknown): unknown;
}
