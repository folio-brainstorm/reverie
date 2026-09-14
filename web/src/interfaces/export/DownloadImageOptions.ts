/** Options controlling how encoded image bytes are delivered to the user. */
export interface DownloadImageOptions {
  /**
   * File name to download.
   *
   * The encoded image's own extension is appended when the name has none, so
   * `"artwork"` becomes `"artwork.png"` for a PNG. A name that already carries
   * an extension is used verbatim.
   */
  readonly filename?: string;
}
