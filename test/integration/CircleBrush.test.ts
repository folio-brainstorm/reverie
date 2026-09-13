import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  Raster,
  ReverieRangeError,
  ReverieTypeError,
} from "@reverie/core";
import type {
  Brush,
  CircleBrushConfig,
  PixelCoord,
  RGBAColor,
} from "@reverie/core";

const OPAQUE_GREEN: RGBAColor = { r: 0, g: 255, b: 0, a: 255 };
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };

describe("CircleBrush construction", () => {
  it("is available with its contracts through the public package entry point", () => {
    const config: CircleBrushConfig = { size: 20, color: OPAQUE_GREEN };
    const brush: Brush = new CircleBrush(config);

    expect(brush).toBeInstanceOf(CircleBrush);
  });

  it("stores size as diameter and defaults opacity and spacing", () => {
    const brush = new CircleBrush({ size: 20, color: OPAQUE_GREEN });

    expect(brush.size).toBe(20);
    expect(brush.opacity).toBe(1);
    expect(brush.spacing).toBe(0.25);
    expect(brush.color).toEqual(OPAQUE_GREEN);
  });

  it("owns its color instead of retaining mutable external state", () => {
    const color = { ...OPAQUE_GREEN };
    const brush = new CircleBrush({ size: 4, color });

    color.g = 0;
    brush.color.g = 0;

    expect(brush.color).toEqual(OPAQUE_GREEN);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid size %s",
    (size) => {
      const createBrush = () => new CircleBrush({ size, color: OPAQUE_GREEN });

      expect(createBrush).toThrow(ReverieRangeError);
      expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_SIZE}]`);
    },
  );

  it("rejects a non-number size at runtime", () => {
    const createBrush = () =>
      new CircleBrush({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        size: "4",
        color: OPAQUE_GREEN,
      });

    expect(createBrush).toThrow(ReverieRangeError);
    expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_SIZE}]`);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects invalid opacity %s",
    (opacity) => {
      const createBrush = () =>
        new CircleBrush({ size: 4, color: OPAQUE_GREEN, opacity });

      expect(createBrush).toThrow(ReverieRangeError);
      expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_OPACITY}]`);
    },
  );

  it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid spacing %s",
    (spacing) => {
      const createBrush = () =>
        new CircleBrush({ size: 4, color: OPAQUE_GREEN, spacing });

      expect(createBrush).toThrow(ReverieRangeError);
      expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_SPACING}]`);
    },
  );

  it("rejects an invalid RGBA8 color", () => {
    const createBrush = () =>
      new CircleBrush({
        size: 4,
        color: { ...OPAQUE_GREEN, a: 1.5 },
      });

    expect(createBrush).toThrow(ReverieRangeError);
    expect(createBrush).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
  });
});

describe("CircleBrush stamping", () => {
  it("uses size as the circle diameter", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 2, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: 0.5, y: 0.5 });

    const paintedPixels: PixelCoord[] = [
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    paintedPixels.forEach((pixel) => {
      expect(raster.getPixel(pixel)).toEqual(OPAQUE_GREEN);
    });
    expect(raster.getPixel({ x: 1, y: 1 })).toEqual(TRANSPARENT_BLACK);
  });

  it("supports fractional world positions", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: 50.5, y: 50.25 });

    expect(raster.getPixel({ x: 50, y: 50 })).toEqual(OPAQUE_GREEN);
  });

  it("supports negative world positions", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: -99.5, y: -49.5 });

    expect(raster.getPixel({ x: -100, y: -50 })).toEqual(OPAQUE_GREEN);
  });

  it("paints continuously across four tiles without knowing tile boundaries", () => {
    const raster = new Raster({ tileSize: 16 });
    const brush = new CircleBrush({ size: 10, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: 15.5, y: 15.5 });

    [
      { x: 15, y: 15 },
      { x: 16, y: 15 },
      { x: 15, y: 16 },
      { x: 16, y: 16 },
    ].forEach((pixel) => {
      expect(raster.getPixel(pixel)).toEqual(OPAQUE_GREEN);
    });
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(4);
    // #endif
  });

  it("combines brush opacity with color alpha through the paint pipeline", () => {
    const raster = new Raster();
    const brush = new CircleBrush({
      size: 1,
      color: { ...OPAQUE_GREEN, a: 128 },
      opacity: 0.5,
    });

    brush.stamp(raster, { x: 0.5, y: 0.5 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_GREEN,
      a: 64,
    });
  });

  it("accumulates repeated stamps using Source Over", () => {
    const raster = new Raster();
    const brush = new CircleBrush({
      size: 1,
      color: OPAQUE_GREEN,
      opacity: 0.5,
    });

    brush.stamp(raster, { x: 0.5, y: 0.5 });
    brush.stamp(raster, { x: 0.5, y: 0.5 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_GREEN,
      a: 192,
    });
  });

  it("does not allocate tiles for a zero-opacity brush", () => {
    const raster = new Raster();
    const brush = new CircleBrush({
      size: 10,
      color: OPAQUE_GREEN,
      opacity: 0,
    });

    brush.stamp(raster, { x: 1_000, y: 1_000 });

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("delegates position validation to the continuous circle rasterizer", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_GREEN });

    expect(() => brush.stamp(raster, { x: Number.NaN, y: 0 })).toThrow(
      ReverieRangeError,
    );
    expect(() => {
      brush.stamp(raster, {
        // @ts-expect-error Runtime validation protects JavaScript callers.
        x: "0",
        y: 0,
      });
    }).toThrow(ReverieTypeError);
  });
});
