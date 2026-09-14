/**
 * A complete image file produced by an encoder, together with the metadata
 * needed to name and deliver it.
 *
 * The bytes are runtime-neutral and are never backed by a Raster, a `Blob`, or
 * any other host object, so an encoded image can be transferred between
 * workers, written to disk, or handed to a browser download layer unchanged.
 */
export interface EncodedImage {
  /** Complete encoded file contents, normalized to a plain `Uint8Array`. */
  readonly data: Uint8Array;

  /** IANA media type of `data`, for example `"image/png"`. */
  readonly mimeType: string;

  /** Canonical lowercase file extension for `data`, without a leading dot. */
  readonly extension: string;
}
