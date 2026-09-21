/** Reader capabilities used to validate required serialized document features. */
export interface DocumentReadOptions {
  /** Semantic feature identifiers understood by the embedding reader. */
  readonly supportedFeatures?: readonly string[];
}
