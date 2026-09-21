/** Stable marker stored at the start of every Reverie project container. */
export const PROJECT_CONTAINER_MAGIC = "RVRP";

/** Byte length of the fixed ASCII project-container marker. */
export const PROJECT_CONTAINER_MAGIC_BYTES = 4;

/** Width of all unsigned 32-bit integer fields in the V1 binary layout. */
export const PROJECT_CONTAINER_UINT32_BYTES = 4;

/** Fixed header size: marker followed by the entry-count uint32. */
export const PROJECT_CONTAINER_HEADER_BYTES =
  PROJECT_CONTAINER_MAGIC_BYTES + PROJECT_CONTAINER_UINT32_BYTES;

/** Maximum number of named entries accepted and produced by V1 containers. */
export const PROJECT_CONTAINER_MAX_ENTRY_COUNT = 100_000;

/** Current physical layout revision for `.reverie` project containers. */
export const PROJECT_CONTAINER_VERSION = 1;

/** Stable format identifier stored in the project manifest. */
export const PROJECT_FORMAT = "reverie-project";

/** Required manifest entry name. */
export const PROJECT_MANIFEST_ENTRY = "manifest.json";

/** Required structured document entry name. */
export const PROJECT_DOCUMENT_ENTRY = "document.json";

/** Prefix reserved for binary Raster tile payload entries. */
export const PROJECT_RASTER_ENTRY_PREFIX = "raster/";

/** Prefix reserved for optional non-authoritative project previews. */
export const PROJECT_PREVIEW_ENTRY_PREFIX = "preview/";
