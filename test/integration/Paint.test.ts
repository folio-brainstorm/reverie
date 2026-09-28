import { describe, expect, it } from "vitest";

import {
  blendSourceOver,
  ErrorCodes,
  paintPixel,
  Raster,
  Rasterizers,
  ReverieRangeError,
} from "@reveriejs/core";
import type { PaintStyle, PixelCoord, RGBAColor } from "@reveriejs/core";

const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };
const OPAQUE_RED: RGBAColor = { r: 255, g: 0, b: 0, a: 255 };
const OPAQUE_BLUE: RGBAColor = { r: 0, g: 0, b: 255, a: 255 };

describe("Source Over blending", () => {
  it("composites transparent black over transparent black", () => {
    expect(blendSourceOver(TRANSPARENT_BLACK, TRANSPARENT_BLACK)).toEqual(
      TRANSPARENT_BLACK,
    );
  });

  it("returns an opaque source regardless of the destination", () => {
    expect(blendSourceOver(OPAQUE_RED, { r: 12, g: 34, b: 56, a: 78 })).toEqual(
      OPAQUE_RED,
    );
  });

  it("leaves the destination unchanged for a transparent source", () => {
    const destination = { r: 12, g: 34, b: 56, a: 78 };

    expect(
      blendSourceOver({ r: 200, g: 100, b: 50, a: 0 }, destination),
    ).toEqual(destination);
  });

  it("preserves straight RGB over a transparent destination", () => {
    expect(
      blendSourceOver({ r: 255, g: 0, b: 0, a: 128 }, TRANSPARENT_BLACK),
    ).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  });

  it("blends half-transparent red over opaque blue with fixed rounding", () => {
    expect(
      blendSourceOver({ r: 255, g: 0, b: 0, a: 128 }, OPAQUE_BLUE),
    ).toEqual({ r: 128, g: 0, b: 127, a: 255 });
  });

  it("composites over a semi-transparent destination", () => {
    expect(
      blendSourceOver(
        { r: 255, g: 0, b: 0, a: 128 },
        { r: 0, g: 0, b: 255, a: 128 },
      ),
    ).toEqual({ r: 170, g: 0, b: 85, a: 192 });
  });

  it.each([
    [{ r: -1, g: 0, b: 0, a: 255 }, OPAQUE_BLUE],
    [OPAQUE_RED, { r: 0, g: 0, b: 256, a: 255 }],
  ])(
    "rejects an invalid source or destination color",
    (source, destination) => {
      const blend = () => blendSourceOver(source, destination);

      expect(blend).toThrow(ReverieRangeError);
      expect(blend).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    },
  );
});

describe("Raster Source Over entry point", () => {
  it("blends over an existing pixel while setPixel retains replace semantics", () => {
    const raster = new Raster();
    const pixel = { x: 4, y: 5 };

    raster.setPixel(pixel, OPAQUE_BLUE);
    raster.blendPixel(pixel, { r: 255, g: 0, b: 0, a: 128 });

    expect(raster.getPixel(pixel)).toEqual({ r: 128, g: 0, b: 127, a: 255 });

    raster.setPixel(pixel, { r: 1, g: 2, b: 3, a: 4 });

    expect(raster.getPixel(pixel)).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it("stores a non-transparent source unchanged over absent storage", () => {
    const raster = new Raster();
    const source = { r: 10, g: 20, b: 30, a: 40 };

    raster.blendPixel({ x: 1_000, y: -1_000 }, source);

    expect(raster.getPixel({ x: 1_000, y: -1_000 })).toEqual(source);
  });

  it("does not allocate storage for a transparent source", () => {
    const raster = new Raster();

    raster.blendPixel({ x: 1_000, y: 1_000 }, TRANSPARENT_BLACK);

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("rejects an invalid source color without allocating storage", () => {
    const raster = new Raster();
    const blend = () =>
      raster.blendPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: Number.NaN });

    expect(blend).toThrow(ReverieRangeError);
    expect(blend).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });
});

describe("pixel painting", () => {
  it("is available with PaintStyle through the public package entry point", () => {
    const raster = new Raster();
    const style: PaintStyle = { color: OPAQUE_RED };

    paintPixel(raster, { pixel: { x: 0, y: 0 }, coverage: 1 }, style);

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(OPAQUE_RED);
  });

  it.each([
    [1, 1, 255],
    [0.5, 1, 128],
    [0.5, 0.5, 64],
  ])(
    "combines coverage %s and opacity %s into alpha %s without scaling RGB",
    (coverage, opacity, expectedAlpha) => {
      const raster = new Raster();

      paintPixel(
        raster,
        { pixel: { x: 0, y: 0 }, coverage },
        { color: OPAQUE_RED, opacity },
      );

      expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
        ...OPAQUE_RED,
        a: expectedAlpha,
      });
    },
  );

  it("combines color alpha independently with opacity and coverage", () => {
    const raster = new Raster();

    paintPixel(
      raster,
      { pixel: { x: 0, y: 0 }, coverage: 0.5 },
      { color: { ...OPAQUE_RED, a: 128 }, opacity: 0.5 },
    );

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_RED,
      a: 32,
    });
  });

  it("accumulates repeated semi-transparent paint with Source Over", () => {
    const raster = new Raster();
    const hit = { pixel: { x: 0, y: 0 }, coverage: 1 };
    const style = { color: OPAQUE_RED, opacity: 0.5 };

    paintPixel(raster, hit, style);
    paintPixel(raster, hit, style);

    expect(raster.getPixel(hit.pixel)).toEqual({ ...OPAQUE_RED, a: 192 });
  });

  it.each([
    ["zero coverage", 0, 1, 255],
    ["zero opacity", 1, 0, 255],
    ["transparent color", 1, 1, 0],
    ["alpha rounded to zero", 0.1, 0.1, 1],
  ])("does not allocate a tile for %s", (_, coverage, opacity, colorAlpha) => {
    const raster = new Raster();

    paintPixel(
      raster,
      { pixel: { x: 1_000, y: 1_000 }, coverage },
      { color: { ...OPAQUE_RED, a: colorAlpha }, opacity },
    );

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it.each<PixelCoord>([
    { x: 255, y: 0 },
    { x: 256, y: 0 },
    { x: -1, y: -257 },
  ])("paints world pixel $x,$y across tile boundaries", (pixel) => {
    const raster = new Raster();

    paintPixel(
      raster,
      { pixel, coverage: 1 },
      { color: OPAQUE_RED, opacity: 0.5 },
    );

    expect(raster.getPixel(pixel)).toEqual({ ...OPAQUE_RED, a: 128 });
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid opacity %s without allocating",
    (opacity) => {
      const raster = new Raster();
      const paint = () =>
        paintPixel(
          raster,
          { pixel: { x: 0, y: 0 }, coverage: 1 },
          { color: OPAQUE_RED, opacity },
        );

      expect(paint).toThrow(ReverieRangeError);
      expect(paint).toThrow(`[${ErrorCodes.PAINT.INVALID_OPACITY}]`);
      // #if DEBUG
      expect(raster.allocatedTileCount).toBe(0);
      // #endif
    },
  );

  it.each([-0.1, 1.1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects invalid coverage %s without allocating",
    (coverage) => {
      const raster = new Raster();
      const paint = () =>
        paintPixel(
          raster,
          { pixel: { x: 0, y: 0 }, coverage },
          { color: OPAQUE_RED },
        );

      expect(paint).toThrow(ReverieRangeError);
      expect(paint).toThrow(`[${ErrorCodes.PAINT.INVALID_COVERAGE}]`);
      // #if DEBUG
      expect(raster.allocatedTileCount).toBe(0);
      // #endif
    },
  );

  it("rejects an invalid paint color without allocating", () => {
    const raster = new Raster();
    const paint = () =>
      paintPixel(
        raster,
        { pixel: { x: 0, y: 0 }, coverage: 1 },
        { color: { r: 255, g: 0, b: 0, a: 1.5 } },
      );

    expect(paint).toThrow(ReverieRangeError);
    expect(paint).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("composes the Step 7 rasterizer with the paint pipeline", () => {
    const raster = new Raster();

    Rasterizers.rasterizeCircle(
      { center: { x: 0.5, y: 0.5 }, radius: 0.5 },
      (hit) => paintPixel(raster, hit, { color: OPAQUE_RED, opacity: 0.5 }),
    );

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_RED,
      a: 128,
    });
  });
});
