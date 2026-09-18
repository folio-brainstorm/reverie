import type { World } from "@reverie/core";
import {
  ExportRenderer,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "@reverie/exporter";
import type { EncodedImage, ExportRegion } from "@reverie/exporter";

import type { ReverieDownloadOptions } from "../interfaces/export/ReverieDownloadOptions.js";
import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebTypeError } from "../errors/WebErrors.js";

/**
 * Composes and encodes a World region without modifying its layers or Raster data.
 * @param world - Ordered document layers to compose.
 * @param region - Explicit world-pixel export region.
 * @param options - Format and encoder options.
 * @returns Encoded image bytes for the requested format.
 * @throws Region validation or encoding errors from the exporter.
 */
export async function encodeWorldRegion(
  world: World,
  region: ExportRegion,
  options: ReverieDownloadOptions,
): Promise<EncodedImage> {
  const requestedFormat = options.format;
  const bitmap = new ExportRenderer({ world }).render(region);

  if (options.format === "png") {
    return new PNGEncoder().encode(bitmap, {
      ...(options.compressionLevel === undefined
        ? {}
        : { compressionLevel: options.compressionLevel }),
    });
  }
  if (options.format === "jpeg") {
    // Preserve automatic browser Buffer setup for the jpeg-js backend.
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
