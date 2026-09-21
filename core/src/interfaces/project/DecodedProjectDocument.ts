import type { ReverieDocumentV1 } from "../document/ReverieDocumentV1.js";

/** Fully reconstructed document data and the payload entries it consumed. */
export interface DecodedProjectDocument {
  /** Validated document representation ready for normal Step 28 hydration. */
  readonly document: ReverieDocumentV1;

  /** Exact binary payload entry names referenced by the document metadata. */
  readonly referencedPayloads: ReadonlySet<string>;
}
