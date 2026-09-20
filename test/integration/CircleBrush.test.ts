import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  Raster,
  ReverieRangeError,
  ReverieTypeError,
} from "@reverie/core";
import type { Brush, CircleBrushConfig, RGBAColor } from "@reverie/core";

const OPAQUE_GREEN: RGBAColor = { r: 0, g: 255, b: 0, a: 255 };

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

    expect(collectAlphaMatrix(raster, -1, -1, 3, 3)).toEqual([
      [22, 128, 22],
      [128, 255, 128],
      [22, 128, 22],
    ]);
  });

  it("supports fractional world positions", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: 50.5, y: 50.25 });

    expect(raster.getPixel({ x: 50, y: 50 })).toEqual({
      ...OPAQUE_GREEN,
      a: 191,
    });
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

  it("keeps coverage identical across horizontal, vertical, and four-tile boundaries", () => {
    const localRaster = new Raster({ tileSize: 16 });
    const verticalRaster = new Raster({ tileSize: 16 });
    const horizontalRaster = new Raster({ tileSize: 16 });
    const intersectionRaster = new Raster({ tileSize: 16 });
    const brush = new CircleBrush({ size: 4, color: OPAQUE_GREEN });

    brush.stamp(localRaster, { x: 4.5, y: 4.5 });
    brush.stamp(verticalRaster, { x: 15.5, y: 4.5 });
    brush.stamp(horizontalRaster, { x: 4.5, y: 15.5 });
    brush.stamp(intersectionRaster, { x: 15.5, y: 15.5 });

    const expected = collectAlphaMatrix(localRaster, 2, 2, 5, 5);
    expect(collectAlphaMatrix(verticalRaster, 13, 2, 5, 5)).toEqual(expected);
    expect(collectAlphaMatrix(horizontalRaster, 2, 13, 5, 5)).toEqual(expected);
    expect(collectAlphaMatrix(intersectionRaster, 13, 13, 5, 5)).toEqual(
      expected,
    );
  });

  it("keeps tiny stamps visible at pixel centers and corners", () => {
    const centeredRaster = new Raster();
    const cornerRaster = new Raster();
    const brush = new CircleBrush({ size: 0.1, color: OPAQUE_GREEN });

    brush.stamp(centeredRaster, { x: 0.5, y: 0.5 });
    brush.stamp(cornerRaster, { x: 0, y: 0 });

    expect(centeredRaster.getPixel({ x: 0, y: 0 }).a).toBeGreaterThan(0);
    expect(collectAlphaMatrix(cornerRaster, -1, -1, 2, 2)).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it("changes edge alpha continuously with subpixel movement", () => {
    const centeredRaster = new Raster();
    const shiftedRaster = new Raster();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_GREEN });

    brush.stamp(centeredRaster, { x: 0.5, y: 0.5 });
    brush.stamp(shiftedRaster, { x: 0.5, y: 0.25 });

    expect(centeredRaster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(shiftedRaster.getPixel({ x: 0, y: 0 }).a).toBe(191);
    expect(shiftedRaster.getPixel({ x: 0, y: -1 }).a).toBe(64);
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

  it("quantizes alpha only after coverage, opacity, and color alpha combine", () => {
    const raster = new Raster();
    const brush = new CircleBrush({
      size: 2,
      color: { ...OPAQUE_GREEN, a: 101 },
      opacity: 0.5,
    });

    brush.stamp(raster, { x: 0.5, y: 0.5 });

    expect(raster.getPixel({ x: 1, y: 0 })).toEqual({
      ...OPAQUE_GREEN,
      a: 25,
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

  it("accumulates repeated fractional edge coverage using Source Over", () => {
    const raster = new Raster();
    const brush = new CircleBrush({ size: 2, color: OPAQUE_GREEN });

    brush.stamp(raster, { x: 0.5, y: 0.5 });
    brush.stamp(raster, { x: 0.5, y: 0.5 });

    expect(raster.getPixel({ x: 1, y: 0 })).toEqual({
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

function collectAlphaMatrix(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): number[][] {
  return Array.from({ length: height }, (_, rowIndex) =>
    Array.from(
      { length: width },
      (_, columnIndex) =>
        raster.getPixel({
          x: left + columnIndex,
          y: top + rowIndex,
        }).a,
    ),
  );
}
