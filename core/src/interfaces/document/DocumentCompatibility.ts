/** Declares the serialized document versions this reader can safely handle. */
export interface DocumentCompatibility {
  /** Most recent schema version emitted by the document writer. */
  readonly writerVersion: number;

  /** Most recent schema version accepted by this reader. */
  readonly currentVersion: number;

  /** Oldest schema version accepted before sequential migration begins. */
  readonly minimumSupportedVersion: number;
}
