import { describe, expect, it } from "vitest";

import {
  ErrorCodes,
  PixelBrush,
  Raster,
  ReverieRangeError,
  ReverieTypeError,
  World,
} from "@reverie/core";
import type {
  Brush,
  PixelBrushConfig,
  PixelCoord,
  RGBAColor,
  StampCommand,
} from "@reverie/core";

const OPAQUE_BLUE: RGBAColor = { r: 0, g: 80, b: 255, a: 255 };
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };

describe("PixelBrush construction", () => {
  it("is available with its config through the public package entry point", () => {
    const config: PixelBrushConfig = { size: 1, color: OPAQUE_BLUE };
    const brush: Brush = new PixelBrush(config);

    expect(brush).toBeInstanceOf(PixelBrush);
  });

  it("stores an integer footprint and defaults opacity and spacing", () => {
    const brush = new PixelBrush({ size: 3, color: OPAQUE_BLUE });

    expect(brush.size).toBe(3);
    expect(brush.opacity).toBe(1);
    expect(brush.spacing).toBe(0.25);
    expect(brush.color).toEqual(OPAQUE_BLUE);
  });

  it("owns its color instead of retaining mutable external state", () => {
    const color = { ...OPAQUE_BLUE };
    const brush = new PixelBrush({ size: 1, color });

    color.b = 0;
    brush.color.b = 0;

    expect(brush.color).toEqual(OPAQUE_BLUE);
  });

  it.each([
    0,
    -1,
    0.5,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects non-positive or non-safe-integer size %s", (size) => {
    const createBrush = () => new PixelBrush({ size, color: OPAQUE_BLUE });

    expect(createBrush).toThrow(ReverieRangeError);
    expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_PIXEL_SIZE}]`);
  });

  it("rejects a non-number size at runtime", () => {
    const createBrush = () =>
      new PixelBrush({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        size: "1",
        color: OPAQUE_BLUE,
      });

    expect(createBrush).toThrow(ReverieRangeError);
    expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_PIXEL_SIZE}]`);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects invalid opacity %s",
    (opacity) => {
      const createBrush = () =>
        new PixelBrush({ size: 1, color: OPAQUE_BLUE, opacity });

      expect(createBrush).toThrow(ReverieRangeError);
      expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_OPACITY}]`);
    },
  );
});

describe("PixelBrush footprint", () => {
  it.each([
    [
      { x: 0.1, y: 0.1 },
      { x: 0, y: 0 },
    ],
    [
      { x: 0.9, y: 0.9 },
      { x: 0, y: 0 },
    ],
    [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ],
    [
      { x: -0.1, y: -0.1 },
      { x: -1, y: -1 },
    ],
    [
      { x: -1, y: -1 },
      { x: -1, y: -1 },
    ],
  ])("snaps a one-pixel stamp at $0 to exactly pixel $1", (position, pixel) => {
    const raster = new Raster({ tileSize: 4 });
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE });

    brush.stamp(raster, position);

    expect(raster.getPixel(pixel)).toEqual(OPAQUE_BLUE);
    expect(collectPaintedPixels(raster, -2, -2, 5, 5)).toEqual([pixel]);
  });

  it("aligns an even footprint around the nearest pixel intersection", () => {
    const leftRaster = new Raster();
    const rightRaster = new Raster();
    const brush = new PixelBrush({ size: 2, color: OPAQUE_BLUE });

    brush.stamp(leftRaster, { x: 0.49, y: 0.49 });
    brush.stamp(rightRaster, { x: 0.51, y: 0.51 });

    expect(collectPaintedPixels(leftRaster, -2, -2, 5, 5)).toEqual([
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(collectPaintedPixels(rightRaster, -2, -2, 5, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it("paints an exact three-by-three odd footprint", () => {
    const raster = new Raster();
    const brush = new PixelBrush({ size: 3, color: OPAQUE_BLUE });

    brush.stamp(raster, { x: 0.2, y: 0.8 });

    expect(collectPaintedPixels(raster, -2, -2, 5, 5)).toEqual([
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it("applies color alpha and opacity without geometric attenuation", () => {
    const raster = new Raster();
    const brush = new PixelBrush({
      size: 1,
      color: { ...OPAQUE_BLUE, a: 101 },
      opacity: 0.5,
    });

    brush.stamp(raster, { x: 0.9, y: 0.9 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_BLUE,
      a: 51,
    });
  });

  it("rounds positive dynamics sizes only when creating the footprint", () => {
    const brush = new PixelBrush({
      size: 3,
      color: OPAQUE_BLUE,
      dynamics: { size: { pressure: { min: 0 } } },
    });
    const twoPixelRaster = new Raster();
    const onePixelRaster = new Raster();

    brush.stamp(twoPixelRaster, { x: 0.5, y: 0.5 }, stamp({ pressure: 0.5 }));
    brush.stamp(onePixelRaster, { x: 0.5, y: 0.5 }, stamp({ pressure: 0.1 }));

    expect(brush.resolveParameters(stamp({ pressure: 0.5 })).size).toBe(1.5);
    expect(collectPaintedPixels(twoPixelRaster, -2, -2, 5, 5)).toHaveLength(4);
    expect(collectPaintedPixels(onePixelRaster, -2, -2, 5, 5)).toEqual([
      { x: 0, y: 0 },
    ]);
  });

  it("treats a zero resolved size as a no-op", () => {
    const raster = new Raster();
    const brush = new PixelBrush({
      size: 3,
      color: OPAQUE_BLUE,
      dynamics: { size: { pressure: { min: 0 } } },
    });

    brush.stamp(raster, { x: 0.5, y: 0.5 }, stamp({ pressure: 0 }));

    expect(raster.allocatedTileCount).toBe(0);
  });

  it("keeps jitter and scatter deterministic for one stamp identity", () => {
    const brush = new PixelBrush({
      size: 3,
      color: OPAQUE_BLUE,
      seed: 123,
      jitter: { size: 0.5, opacity: 0.25 },
      scatter: { along: 1, across: 1 },
    });
    const first = new Raster();
    const second = new Raster();
    const input = stamp({ strokeSeed: 456, stampIndex: 7, direction: 0.3 });

    brush.stamp(first, { x: 10.5, y: 10.5 }, input);
    brush.stamp(second, { x: 10.5, y: 10.5 }, input);

    expect(readAlphaRegion(second, 0, 0, 24, 24)).toEqual(
      readAlphaRegion(first, 0, 0, 24, 24),
    );
  });

  it("crosses a four-tile intersection without seams", () => {
    const raster = new Raster({ tileSize: 4 });
    const brush = new PixelBrush({ size: 2, color: OPAQUE_BLUE });

    brush.stamp(raster, { x: 4, y: 4 });

    expect(collectPaintedPixels(raster, 2, 2, 4, 4)).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
    expect(raster.allocatedTileCount).toBe(4);
  });
});

describe("PixelBrush paint boundaries and modes", () => {
  it("clips before allocating pixels outside World bounds", () => {
    const world = new World({
      tileSize: 4,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    const layer = world.getLayer(0);
    const brush = new PixelBrush({ size: 3, color: OPAQUE_BLUE });

    layer.stamp(brush, { x: 0.1, y: 0.1 });

    expect(collectPaintedPixels(layer.raster, -1, -1, 4, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(layer.raster.allocatedTileCount).toBe(1);
  });

  it("erases the complete footprint and skips missing tiles", () => {
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 0, y: 0 }, OPAQUE_BLUE);
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE, opacity: 0.5 });
    const erase = stamp({ paintMode: "erase" });

    brush.stamp(raster, { x: 0.9, y: 0.9 }, erase);
    brush.stamp(raster, { x: 100.5, y: 100.5 }, erase);

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_BLUE,
      a: 128,
    });
    expect(raster.allocatedTileCount).toBe(1);
  });

  it("does not allocate for zero opacity or transparent paint", () => {
    const opacityRaster = new Raster();
    const transparentRaster = new Raster();

    new PixelBrush({
      size: 3,
      color: OPAQUE_BLUE,
      opacity: 0,
    }).stamp(opacityRaster, { x: 100.5, y: 100.5 });
    new PixelBrush({
      size: 3,
      color: TRANSPARENT_BLACK,
    }).stamp(transparentRaster, { x: 100.5, y: 100.5 });

    expect(opacityRaster.allocatedTileCount).toBe(0);
    expect(transparentRaster.allocatedTileCount).toBe(0);
  });

  it("rejects malformed or unsafe stamp positions", () => {
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE });

    expect(() =>
      brush.stamp(new Raster(), {
        // @ts-expect-error Runtime validation protects JavaScript callers.
        x: "0",
        y: 0,
      }),
    ).toThrow(ReverieTypeError);
    expect(() => brush.stamp(new Raster(), { x: Number.NaN, y: 0 })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_PIXEL_STAMP_POSITION}]`,
    );
    expect(() =>
      brush.stamp(new Raster(), { x: Number.MAX_SAFE_INTEGER + 1, y: 0 }),
    ).toThrow(`[${ErrorCodes.BRUSH.UNSAFE_PIXEL_STAMP_BOUNDS}]`);
  });
});

function stamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return {
    position: { x: 0.5, y: 0.5 },
    strokeSeed: 0,
    stampIndex: 0,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    velocity: 0,
    ...overrides,
  };
}

function collectPaintedPixels(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): PixelCoord[] {
  const pixels: PixelCoord[] = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (raster.getPixel({ x, y }).a > 0) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

function readAlphaRegion(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): number[] {
  const alpha: number[] = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      alpha.push(raster.getPixel({ x, y }).a);
    }
  }
  return alpha;
}
