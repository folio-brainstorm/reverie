import { readFileSync } from "node:fs";

import { init } from "@jsquash/webp/decode.js";

/**
 * Loads libwebp's decoder from the installed WASM asset for deterministic tests.
 * @returns A promise resolving when local decoder initialization is requested.
 */
export async function initializeWebpDecoder(): Promise<void> {
  const wasm = readFileSync(
    new URL(import.meta.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")),
  );
  const options = {
    noInitialRun: true,
    wasmBinary: new Uint8Array(wasm).buffer,
  };
  await init(options);
}
