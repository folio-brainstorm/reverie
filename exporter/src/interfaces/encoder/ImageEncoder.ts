import type { ExportResult } from "../renderer/ExportResult.js";

import type { EncodedImage } from "./EncodedImage.js";

/**
 * Converts a dense RGBA8 bitmap into one concrete image format.
 *
 * Implementations are stateless and read-only: encoding never mutates the
 * supplied bitmap and never depends on state left behind by a previous call.
 *
 * @typeParam TOptions - Format-specific options; `undefined` when the format
 * accepts no options.
 */
export interface ImageEncoder<TOptions = undefined> {
  /**
   * Encodes one bitmap into a complete image file.
   *
   * The returned promise always resolves with a fresh {@link EncodedImage}
   * owned by the caller. The contract is asynchronous even for backends that
   * currently encode synchronously, so later implementations may initialize
   * WASM, dispatch to a worker, or await a runtime-native codec without
   * changing callers.
   *
   * @param image - Dense RGBA8 bitmap, normally produced by an export pass.
   * @param options - Format-specific options; omitted values use the encoder's
   * documented defaults.
   * @returns The encoded bytes together with their media type and extension.
   * @throws {ExporterTypeError} The bitmap or an option has the wrong type.
   * @throws {ExporterRangeError} The bitmap dimensions, buffer length, or an
   * option value is outside the supported range.
   * @throws {ExporterError} The format backend failed to encode the bitmap.
   */
  encode(image: ExportResult, options?: TOptions): Promise<EncodedImage>;
}
