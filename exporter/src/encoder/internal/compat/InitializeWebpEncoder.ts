import { init as initWebpEncoder } from "@jsquash/webp/encode.js";
import { simd } from "wasm-feature-detect";

let initialization: Promise<void> | undefined;

/**
 * Initializes libwebp once, loading WASM from the installed package in Node or
 * allowing the backend's asset URLs to be resolved by browser bundlers.
 *
 * Concurrent exports share initialization. A failed initialization is cleared
 * so a subsequent export can retry without retaining a rejected promise.
 *
 * @returns A promise resolving when the encoder is ready.
 * @throws If the WASM asset cannot be loaded or instantiated.
 */
export function initializeWebpEncoder(): Promise<void> {
  if (initialization === undefined) {
    initialization = initializeBackend().catch((cause: unknown) => {
      initialization = undefined;
      throw cause;
    });
  }

  return initialization;
}

/** Node cannot fetch file URLs, so supply the selected WASM binary directly. */
async function initializeBackend(): Promise<void> {
  const isNode =
    typeof process !== "undefined" && process.versions?.node !== undefined;
  if (!isNode) {
    await initWebpEncoder();
    return;
  }

  const { readFile } = await import("node:fs/promises");
  const filename = (await simd()) ? "webp_enc_simd.wasm" : "webp_enc.wasm";
  const wasm = await readFile(
    new URL(import.meta.resolve(`@jsquash/webp/codec/enc/${filename}`)),
  );
  // Emscripten accepts wasmBinary, which is omitted from this package's options type.
  const options = {
    noInitialRun: true,
    wasmBinary: new Uint8Array(wasm).buffer,
  };
  await initWebpEncoder(options);
}
