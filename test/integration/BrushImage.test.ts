import { describe, expect, it } from "vitest";

import { BrushImage, ErrorCodes, ReverieRangeError } from "@reveriejs/core";
import type { BrushImageConfig, RGBABrushImageSource } from "@reveriejs/core";

describe("BrushImage construction and ownership", () => {
  it("is available with its public configuration contracts", () => {
    const config: BrushImageConfig = {
      width: 2,
      height: 1,
      alpha: new Uint8Array([0, 255]),
    };
    const image = new BrushImage(config);

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.alpha).toEqual(new Uint8Array([0, 255]));
    expect(image.hasCoverage).toBe(true);
  });

  it("creates a fully opaque mask when source alpha is absent", () => {
    const image = new BrushImage({ width: 2, height: 2 });

    expect(image.alpha).toEqual(new Uint8Array([255, 255, 255, 255]));
  });

  it("owns its alpha data and never exposes the mutable internal buffer", () => {
    const alpha = new Uint8Array([0, 255]);
    const image = new BrushImage({ width: 2, height: 1, alpha });

    alpha[0] = 255;
    image.alpha[1] = 0;

    expect(image.alpha).toEqual(new Uint8Array([0, 255]));
  });

  it("reports whether the image contains any paint coverage", () => {
    expect(
      new BrushImage({
        width: 2,
        height: 1,
        alpha: new Uint8Array([0, 0]),
      }).hasCoverage,
    ).toBe(false);
    expect(
      new BrushImage({
        width: 2,
        height: 1,
        alpha: new Uint8Array([0, 1]),
      }).hasCoverage,
    ).toBe(true);
  });

  it.each([
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER, 2],
  ])("rejects invalid dimensions %s by %s", (width, height) => {
    const createImage = () => new BrushImage({ width, height });

    expect(createImage).toThrow(ReverieRangeError);
    expect(createImage).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_DIMENSIONS}]`,
    );
  });

  it("rejects an alpha buffer whose length does not match its dimensions", () => {
    const createImage = () =>
      new BrushImage({
        width: 2,
        height: 2,
        alpha: new Uint8Array(3),
      });

    expect(createImage).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_ALPHA_BUFFER}]`,
    );
  });

  it("rejects a non-Uint8 alpha buffer at runtime", () => {
    const createImage = () =>
      new BrushImage({
        width: 1,
        height: 1,
        // @ts-expect-error Runtime validation protects JavaScript callers.
        alpha: [255],
      });

    expect(createImage).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_ALPHA_BUFFER}]`,
    );
  });
});

describe("BrushImage RGBA conversion", () => {
  it("extracts alpha while ignoring completely different RGB channels", () => {
    const redSource: RGBABrushImageSource = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 32, 255, 0, 0, 224]),
    };
    const blueSource: RGBABrushImageSource = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([0, 0, 255, 32, 0, 0, 255, 224]),
    };

    expect(BrushImage.fromRGBA(redSource).alpha).toEqual(
      BrushImage.fromRGBA(blueSource).alpha,
    );
    expect(BrushImage.fromRGBA(redSource).alpha).toEqual(
      new Uint8Array([32, 224]),
    );
  });

  it("accepts browser-compatible Uint8ClampedArray pixels", () => {
    const image = BrushImage.fromRGBA({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([10, 20, 30, 40]),
    });

    expect(image.alpha).toEqual(new Uint8Array([40]));
  });

  it("rejects an RGBA buffer whose length does not match its dimensions", () => {
    const createImage = () =>
      BrushImage.fromRGBA({
        width: 2,
        height: 1,
        pixels: new Uint8Array(7),
      });

    expect(createImage).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_RGBA_BUFFER}]`,
    );
  });
});

describe("BrushImage bilinear sampling", () => {
  it("interpolates halfway between neighboring source pixel centers", () => {
    const image = new BrushImage({
      width: 2,
      height: 1,
      alpha: new Uint8Array([0, 255]),
    });

    expect(image.sampleAlpha(0.5, 0.5)).toBe(0);
    expect(image.sampleAlpha(1, 0.5)).toBeCloseTo(0.5);
    expect(image.sampleAlpha(1.5, 0.5)).toBe(1);
  });

  it("treats missing edge neighbors as transparent", () => {
    const image = new BrushImage({
      width: 1,
      height: 1,
      alpha: new Uint8Array([255]),
    });

    expect(image.sampleAlpha(0.5, 0.5)).toBe(1);
    expect(image.sampleAlpha(0, 0.5)).toBeCloseTo(0.5);
    expect(image.sampleAlpha(0.5, 0)).toBeCloseTo(0.5);
  });

  it.each([
    [-0.01, 0.5],
    [1, 0.5],
    [0.5, -0.01],
    [0.5, 1],
    [Number.NaN, 0.5],
  ])("returns transparent coverage outside (%s, %s)", (x, y) => {
    const image = new BrushImage({ width: 1, height: 1 });

    expect(image.sampleAlpha(x, y)).toBe(0);
  });
});
