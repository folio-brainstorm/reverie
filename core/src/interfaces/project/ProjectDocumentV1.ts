/** JSON-safe document metadata stored separately from binary Raster payload entries. */
export interface ProjectDocumentV1 {
  /** Stable document identity. */
  readonly id: string;

  /** Serialized document-format marker. */
  readonly format: "reverie-document";

  /** Document schema revision. */
  readonly version: number;

  /** Oldest compatible document reader revision. */
  readonly minimumReaderVersion: number;

  /** Semantic features required to read the document. */
  readonly requiredFeatures?: readonly string[];

  /** World and Layer metadata. */
  readonly world: ProjectWorldV1;
}

/** JSON-safe World metadata for a project document. */
export interface ProjectWorldV1 {
  /** Shared tile edge length. */
  readonly tileSize: number;

  /** Optional bounded World rectangle. */
  readonly bounds: ProjectWorldBoundsV1 | null;

  /** Ordered Layer metadata. */
  readonly layers: readonly ProjectLayerV1[];
}

/** JSON-safe bounded World rectangle. */
export interface ProjectWorldBoundsV1 {
  /** Horizontal origin in document pixels. */
  readonly x: number;

  /** Vertical origin in document pixels. */
  readonly y: number;

  /** Horizontal extent in document pixels. */
  readonly width: number;

  /** Vertical extent in document pixels. */
  readonly height: number;
}

/** JSON-safe Layer metadata and Raster payload references. */
export interface ProjectLayerV1 {
  /** Stable Layer identity. */
  readonly id: string;

  /** User-visible Layer name. */
  readonly name: string;

  /** Whether the Layer is visible. */
  readonly visible: boolean;

  /** Layer opacity. */
  readonly opacity: number;

  /** Layer compositing mode. */
  readonly blendMode: string;

  /** Sparse Raster metadata. */
  readonly raster: ProjectRasterV1;
}

/** JSON-safe sparse Raster metadata. */
export interface ProjectRasterV1 {
  /** Tile edge length. */
  readonly tileSize: number;

  /** Pixel layout marker. */
  readonly pixelFormat: string;

  /** Sparse Tile metadata. */
  readonly tiles: readonly ProjectRasterTileV1[];
}

/** Metadata for a single Raster Tile stored outside the JSON document entry. */
export interface ProjectRasterTileV1 {
  /** Horizontal Tile coordinate. */
  readonly x: number;

  /** Vertical Tile coordinate. */
  readonly y: number;

  /** Binary payload descriptor. */
  readonly payload: ProjectPixelPayloadV1;
}

/** Reference to a raw binary Tile payload entry. */
export interface ProjectPixelPayloadV1 {
  /** Raster semantic encoding, independent of container compression. */
  readonly encoding: string;

  /** Exact project-container entry name containing raw bytes. */
  readonly entry: string;
}
