/** Stable marker identifying serialized Reverie document envelopes. */
export const DOCUMENT_FORMAT = "reverie-document";

/** Immutable schema version implemented by the V1 parser and writer. */
export const V1_DOCUMENT_VERSION = 1;

/** Reader generation required by the V1 schema emitted by this writer. */
export const V1_MINIMUM_READER_VERSION = 1;

/** Current integer revision of the serialized Reverie document schema. */
export const CURRENT_DOCUMENT_VERSION = V1_DOCUMENT_VERSION;

/** Oldest historical schema version this reader can migrate or parse. */
export const MINIMUM_SUPPORTED_DOCUMENT_VERSION = 1;

/** Oldest reader generation compatible with documents written by this version. */
export const MINIMUM_READER_VERSION = V1_MINIMUM_READER_VERSION;
