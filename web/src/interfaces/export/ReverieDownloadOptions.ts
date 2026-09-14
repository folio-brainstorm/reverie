import type { RGBAColor } from "@reverie/core";
import type { ExportRegion, PNGCompressionLevel } from "@reverie/exporter";

/**
 * One high-level image download request for the Web facade.
 *
 * The union keeps each format paired with the encoder options that format
 * actually accepts, so PNG cannot receive JPEG quality and WebP cannot receive a
 * JPEG compositing background.
 *
 * @example
 * const request: ReverieDownloadOptions = {
 *   format: "jpeg",
 *   filename: "artwork.jpg",
 *   quality: 0.9,
 * };
 */
export type ReverieDownloadOptions =
  | {
      /** Requests a lossless PNG file. */
      readonly format: "png";

      /** File name to download; defaults to `drawing.png`. */
      readonly filename?: string;

      /** World-pixel region to export; defaults to the World's bounds. */
      readonly region?: ExportRegion;

      /** Deflate effort from `0` (store) to `9` (maximum); defaults to `6`. */
      readonly compressionLevel?: PNGCompressionLevel;
    }
  | {
      /** Requests a baseline JPEG file. */
      readonly format: "jpeg";

      /** File name to download; defaults to `drawing.jpg`. */
      readonly filename?: string;

      /** World-pixel region to export; defaults to the World's bounds. */
      readonly region?: ExportRegion;

      /** Normalized quality in the inclusive `0..1` range. */
      readonly quality?: number;

      /** Fully opaque color composited behind transparent pixels. */
      readonly background?: RGBAColor;
    }
  | {
      /** Requests a WebP file. */
      readonly format: "webp";

      /** File name to download; defaults to `drawing.webp`. */
      readonly filename?: string;

      /** World-pixel region to export; defaults to the World's bounds. */
      readonly region?: ExportRegion;

      /** Normalized quality in the inclusive `0..1` range. */
      readonly quality?: number;

      /** Whether to encode losslessly, preserving the alpha channel. */
      readonly lossless?: boolean;
    };
