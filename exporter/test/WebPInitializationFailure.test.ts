import { describe, expect, it, vi } from "vitest";

const initializationFailure = vi.hoisted(
  () => new Error("Simulated WASM initialization failure."),
);

vi.mock("@jsquash/webp/encode.js", () => ({
  init: vi
    .fn()
    .mockRejectedValueOnce(initializationFailure)
    .mockResolvedValue(undefined),
  default: async (): Promise<ArrayBuffer> => Uint8Array.from([1, 2, 3]).buffer,
}));

import { ExporterErrorDefinitions, WebPEncoder } from "../index.js";

describe("WebP initialization", () => {
  it("reports initialization failures and allows a later export to retry", async () => {
    const image = {
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([220, 40, 90, 255]),
    };

    await expect(new WebPEncoder().encode(image)).rejects.toMatchObject({
      code: ExporterErrorDefinitions.ENCODING_FAILED.code,
      cause: initializationFailure,
    });
    const encoded = await new WebPEncoder().encode(image);

    expect(Array.from(encoded.data)).toEqual([1, 2, 3]);
  });
});
