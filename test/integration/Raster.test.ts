import { describe, expect, it } from "vitest";

import { ErrorCodes, Raster as PublicRaster } from "@reverie/core";
import type { PixelCoord, RasterConfig, RGBAColor } from "@reverie/core";
import { Raster } from "../../core/src/core/raster/Raster";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../core/src/utils/errors/ReverieErrors";

const TILE_SIZE = 256;
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };
const RED: RGBAColor = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBAColor = { r: 0, g: 0, b: 255, a: 128 };

describe("Raster construction", () => {
  it("is available through the public package entry point", () => {
    const config: RasterConfig = { tileSize: 512 };
    const raster = new PublicRaster(config);

    expect(raster).toBeInstanceOf(PublicRaster);
    expect(raster.tileSize).toBe(512);
  });

  it("defaults to immutable 256-pixel tiles", () => {
    const raster = new Raster();

    expect(raster.tileSize).toBe(TILE_SIZE);

    if (false) {
      // @ts-expect-error A raster cannot change tile size after construction.
      raster.tileSize = 512;
      // @ts-expect-error Sparse tile storage is an internal implementation detail.
      void raster.tileStore;
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tile size %s",
    (tileSize) => {
      const createRaster = () => new Raster({ tileSize });

      expect(createRaster).toThrow(ReverieRangeError);
      expect(createRaster).toThrow(`[${ErrorCodes.COMMON.UNSAFE_TILE_SIZE}]`);
    },
  );
});

describe("Raster world-pixel access", () => {
  it.each<PixelCoord>([
    { x: 0, y: 0 },
    { x: TILE_SIZE - 1, y: TILE_SIZE - 1 },
    { x: TILE_SIZE, y: TILE_SIZE },
    { x: -1, y: -1 },
    { x: -TILE_SIZE, y: -TILE_SIZE },
    { x: -TILE_SIZE - 1, y: -TILE_SIZE - 1 },
    { x: -257, y: 300 },
  ])("sets and gets world pixel $x,$y", (pixel) => {
    const raster = new Raster();

    raster.setPixel(pixel, RED);

    expect(raster.getPixel(pixel)).toEqual(RED);
  });

  it("reads absent pixels without allocating or exposing shared color state", () => {
    const raster = new Raster();
    const firstRead = raster.getPixel({ x: 1_000_000, y: -1_000_000 });

    firstRead.r = 255;

    expect(raster.getPixel({ x: 1_000_000, y: -1_000_000 })).toEqual(
      TRANSPARENT_BLACK,
    );
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("keeps neighboring pixels independent", () => {
    const raster = new Raster();

    raster.setPixel({ x: 10, y: 20 }, RED);

    expect(raster.getPixel({ x: 10, y: 20 })).toEqual(RED);
    expect(raster.getPixel({ x: 11, y: 20 })).toEqual(TRANSPARENT_BLACK);
    expect(raster.getPixel({ x: 10, y: 21 })).toEqual(TRANSPARENT_BLACK);
  });

  it("replaces an existing color without alpha blending", () => {
    const raster = new Raster();
    const pixel = { x: 10, y: 20 };

    raster.setPixel(pixel, RED);
    raster.setPixel(pixel, BLUE);

    expect(raster.getPixel(pixel)).toEqual(BLUE);
  });

  it("allocates a tile for a transparent write", () => {
    const raster = new Raster();

    raster.setPixel({ x: 10, y: 20 }, TRANSPARENT_BLACK);

    expect(raster.getPixel({ x: 10, y: 20 })).toEqual(TRANSPARENT_BLACK);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(1);
    // #endif
  });
});

describe("Raster sparse tile allocation", () => {
  it("reuses one tile for multiple pixels in the same tile grid cell", () => {
    const raster = new Raster();

    raster.setPixel({ x: 10, y: 10 }, RED);
    raster.setPixel({ x: 20, y: 20 }, RED);
    raster.setPixel({ x: 100, y: 100 }, RED);

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(1);
    // #endif
  });

  it("allocates distinct tiles across positive and negative boundaries", () => {
    const raster = new Raster();
    const pixels = [
      { x: 0, y: 0 },
      { x: TILE_SIZE, y: 0 },
      { x: 0, y: TILE_SIZE },
      { x: -1, y: 0 },
    ];

    pixels.forEach((pixel) => raster.setPixel(pixel, RED));

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(4);
    // #endif
  });

  it("clears every distant tile and restores transparent reads", () => {
    const raster = new Raster();
    const pixels = [
      { x: 0, y: 0 },
      { x: 10_000, y: 10_000 },
      { x: -10_000, y: -10_000 },
    ];
    pixels.forEach((pixel) => raster.setPixel(pixel, RED));

    raster.clear();

    pixels.forEach((pixel) => {
      expect(raster.getPixel(pixel)).toEqual(TRANSPARENT_BLACK);
    });
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });
});

describe("Raster input validation", () => {
  it.each([
    ["getPixel", (raster: Raster, pixel: PixelCoord) => raster.getPixel(pixel)],
    [
      "setPixel",
      (raster: Raster, pixel: PixelCoord) => raster.setPixel(pixel, RED),
    ],
    [
      "blendPixel",
      (raster: Raster, pixel: PixelCoord) => raster.blendPixel(pixel, RED),
    ],
  ] as const)("rejects unsafe coordinates passed to %s", (_, operation) => {
    const raster = new Raster();
    const invalidPixels = [
      { x: 1.5, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      { x: Number.MAX_VALUE, y: 0 },
    ];

    invalidPixels.forEach((pixel) => {
      expect(() => operation(raster, pixel)).toThrow(ReverieRangeError);
      expect(() => operation(raster, pixel)).toThrow(
        `[${ErrorCodes.COMMON.UNSAFE_COORDINATE_VALUE}]`,
      );
    });
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("rejects non-number world-coordinate components", () => {
    const raster = new Raster();

    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      raster.getPixel({ x: "0", y: 0 });
    }).toThrow(ReverieTypeError);
  });

  it.each([
    { r: -1, g: 0, b: 0, a: 0 },
    { r: 256, g: 0, b: 0, a: 0 },
    { r: 0.5, g: 0, b: 0, a: 0 },
    { r: Number.NaN, g: 0, b: 0, a: 0 },
    { r: 0, g: Number.POSITIVE_INFINITY, b: 0, a: 0 },
  ])("rejects invalid RGBA color $r,$g,$b,$a without allocating", (color) => {
    const raster = new Raster();
    const setPixel = () => raster.setPixel({ x: 0, y: 0 }, color);

    expect(setPixel).toThrow(ReverieRangeError);
    expect(setPixel).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });
});

describe("Raster debug instrumentation", () => {
  it("matches the selected conditional-compilation mode", () => {
    const raster = new Raster({ tileSize: 16 });

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);

    raster.setPixel({ x: 0, y: 0 }, RED);

    expect(raster.allocatedTileCount).toBe(1);
    // #else
    expect("allocatedTileCount" in raster).toBe(false);
    // #endif
  });
});
