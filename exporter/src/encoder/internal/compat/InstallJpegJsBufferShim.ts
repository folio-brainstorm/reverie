import type { BufferShim } from "../../../interfaces/encoder/BufferShim.js";

/** Minimal `Buffer` implementation the bundled `jpeg-js` encoder requires. */
const JPEG_JS_BUFFER_SHIM: BufferShim = {
  from: (bytes) => Uint8Array.from(bytes),
};

/**
 * Installs the global `Buffer` that a bundled `jpeg-js` encoder requires.
 *
 * `jpeg-js` is published as CommonJS and finishes by calling the bare global
 * `Buffer` from the branch a bundler always selects. The call is idempotent and
 * never replaces an existing `Buffer`, so runtimes that already provide one,
 * such as Node.js, keep their own implementation.
 *
 * @example
 * installJpegJsBufferShim();
 * const bytes = encodeJpegBytes(image, 0.92, background);
 */
export function installJpegJsBufferShim(): void {
  const host = globalThis as { Buffer?: BufferShim };

  host.Buffer ??= JPEG_JS_BUFFER_SHIM;
}
