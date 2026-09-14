import type { Raster } from "@reverie/core";
import {
  ExportRenderer,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "@reverie/exporter";
import type { EncodedImage, ExportRegion } from "@reverie/exporter";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebTypeError } from "../errors/WebErrors.js";
import type { ReverieDownloadOptions } from "../interfaces/export/ReverieDownloadOptions.js";

/**
 * Renders one Raster region and encodes it in the requested image format.
 *
 * The bitmap is extracted with the shared `ExportRenderer`, so the Raster is only
 * ever read, and encoded with the Step 16B encoders. Format-specific options are
 * forwarded unchanged; omitted options keep each encoder's documented default.
 *
 * @param raster - Sparse Raster read without mutation.
 * @param region - World-pixel region to render and encode.
 * @param options - Download request selecting the format and its encoder options.
 * @returns The encoded file for the requested format.
 * @throws {WebTypeError} The runtime `format` is not a supported export format.
 * @throws {ExporterRangeError} The region is unusable or an encoder option is
 * outside its supported range.
 * @throws {ExporterError} The format backend failed to encode the bitmap.
 *
 * @example
 * const image = await encodeRasterRegion(raster, region, { format: "png" });
 */
export async function encodeRasterRegion(
  raster: Raster,
  region: ExportRegion,
  options: ReverieDownloadOptions,
): Promise<EncodedImage> {
  // Read before the format narrows `options`, so the fallthrough diagnostic can
  // still report the received value.
  const requestedFormat = options.format;
  const bitmap = new ExportRenderer({ raster }).render(region);

  if (options.format === "png") {
    return new PNGEncoder().encode(bitmap, {
      ...(options.compressionLevel === undefined
        ? {}
        : { compressionLevel: options.compressionLevel }),
    });
  }

  if (options.format === "jpeg") {
    // `jpeg-js` finishes through a global `Buffer` that browsers do not provide,
    // so the shim is installed before the encoder checks for it.
    JPEGEncoder.installJpegJsBufferShim();

    return new JPEGEncoder().encode(bitmap, {
      ...(options.quality === undefined ? {} : { quality: options.quality }),
      ...(options.background === undefined
        ? {}
        : { background: options.background }),
    });
  }

  if (options.format === "webp") {
    return new WebPEncoder().encode(bitmap, {
      ...(options.quality === undefined ? {} : { quality: options.quality }),
      ...(options.lossless === undefined ? {} : { lossless: options.lossless }),
    });
  }

  throw WebTypeError.from(WebErrorDefinitions.UNSUPPORTED_EXPORT_FORMAT, {
    received: requestedFormat,
  });
}
