/**
 * The subset of Node's `Buffer` global that the bundled `jpeg-js` encoder
 * reaches for.
 *
 * `jpeg-js` is published as CommonJS and finishes by converting its byte array
 * with the bare global `Buffer`:
 *
 *     if (typeof module === 'undefined') return new Uint8Array(byteout);
 *     return Buffer.from(byteout);
 *
 * A bundler always defines `module`, so a browser bundle selects the second
 * branch even though the output runs in a browser, where `Buffer` does not
 * exist. `JPEGEncoder.installJpegJsBufferShim()` installs an object of this
 * shape to keep JPEG encoding working there.
 *
 * Only `from` is declared: the exporter copies the returned value into a plain
 * `Uint8Array` immediately, so a complete Node polyfill would carry unused
 * weight.
 *
 * The global is read and written through a structural view rather than a
 * `declare global` augmentation, so this package never redeclares a `Buffer`
 * that a host environment, or a consumer's `@types/node`, already owns.
 */
export interface BufferShim {
  /**
   * Copies an array of byte values into a byte view.
   *
   * @param bytes - Byte values in the inclusive `0..255` range.
   * @returns A new byte view holding a copy of `bytes`.
   */
  from(bytes: readonly number[]): Uint8Array;
}
