import type { SerializedWorldV1 } from "./SerializedWorldV1.js";

/** Stable V1 envelope for Reverie documents and their Raster pixels. */
export interface ReverieDocumentV1 {
  /** Stable document identity, independent of runtime object references. */
  readonly id: string;

  /** Fixed marker identifying a Reverie serialized document. */
  readonly format: "reverie-document";

  /** Integer schema revision used by this payload. */
  readonly version: 1;

  /** Oldest reader schema generation that can interpret this payload. */
  readonly minimumReaderVersion: 1;

  /** Semantic capabilities a reader must understand before accepting the payload. */
  readonly requiredFeatures?: readonly string[];

  /** Stable document state, excluding session and rendering state. */
  readonly world: SerializedWorldV1;
}
