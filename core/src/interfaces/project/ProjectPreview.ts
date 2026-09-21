/** Optional non-authoritative preview bytes packaged alongside a project document. */
export interface ProjectPreview {
  /** Media type describing the preview byte representation. */
  readonly mimeType: string;

  /** Complete preview asset bytes, independent of the document's Raster payloads. */
  readonly data: Uint8Array;
}
