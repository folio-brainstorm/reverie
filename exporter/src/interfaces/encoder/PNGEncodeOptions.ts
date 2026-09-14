import type { PNGCompressionLevel } from "./PNGCompressionLevel.js";

/** Options accepted by the PNG encoder. */
export interface PNGEncodeOptions {
  /**
   * Deflate effort from `0` (store without compression) to `9` (maximum
   * compression). Defaults to `6`.
   *
   * The choice never affects the decoded pixels, because PNG output is always
   * lossless; it only trades encoding time for a smaller file.
   */
  compressionLevel?: PNGCompressionLevel;
}
