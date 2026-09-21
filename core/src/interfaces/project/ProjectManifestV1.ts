/** Compatibility information that can be inspected before decoding document data. */
export interface ProjectManifestV1 {
  /** Fixed marker identifying a Reverie project container. */
  readonly format: "reverie-project";

  /** Physical container-layout revision. */
  readonly containerVersion: 1;

  /** Serialized document schema revision stored by the container. */
  readonly documentVersion: number;

  /** Oldest document reader revision that can load the stored document. */
  readonly minimumReaderVersion: number;

  /** Semantic document capabilities required by the stored document. */
  readonly requiredFeatures?: readonly string[];
}
