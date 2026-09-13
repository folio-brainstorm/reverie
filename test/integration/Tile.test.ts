import { describe, expect, it } from "vitest";

import { ErrorCodes, ReverieRangeError, Tile } from "@reverie/core";
import type { RGBAColor } from "@reverie/core";

const TILE_SIZE = 4;
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };
const TEST_COLOR: RGBAColor = { r: 255, g: 128, b: 64, a: 32 };

describe("Tile construction", () => {
  it("creates a fixed-size transparent tile without dirty pixels", () => {
    const tile = new Tile({ size: TILE_SIZE });

    expect(tile.size).toBe(TILE_SIZE);
    expect(tile.getPixel({ x: 0, y: 0 })).toEqual(TRANSPARENT_BLACK);
    expect(tile.getPixel({ x: TILE_SIZE - 1, y: TILE_SIZE - 1 })).toEqual(
      TRANSPARENT_BLACK,
    );
    expect(tile.dirtyBounds).toBeNull();
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid tile size %s",
    (size) => {
      expect(() => new Tile({ size })).toThrow(ReverieRangeError);
      expect(() => new Tile({ size })).toThrow(
        `[${ErrorCodes.COMMON.UNSAFE_TILE_SIZE}]`,
      );
    },
  );
});

describe("Tile pixel access", () => {
  it.each([
    { x: 0, y: 0 },
    { x: TILE_SIZE - 1, y: 0 },
    { x: 0, y: TILE_SIZE - 1 },
    { x: TILE_SIZE - 1, y: TILE_SIZE - 1 },
  ])("sets and gets boundary pixel $x,$y", (coord) => {
    const tile = new Tile({ size: TILE_SIZE });

    tile.setPixel(coord, TEST_COLOR);

    expect(tile.getPixel(coord)).toEqual(TEST_COLOR);
  });

  it("uses row-major RGBA offsets without modifying neighboring pixels", () => {
    const tile = new Tile({ size: TILE_SIZE });
    const writes = [
      [
        { x: 0, y: 0 },
        { r: 1, g: 2, b: 3, a: 4 },
      ],
      [
        { x: 1, y: 0 },
        { r: 5, g: 6, b: 7, a: 8 },
      ],
      [
        { x: 0, y: 1 },
        { r: 9, g: 10, b: 11, a: 12 },
      ],
      [
        { x: TILE_SIZE - 1, y: TILE_SIZE - 1 },
        { r: 13, g: 14, b: 15, a: 16 },
      ],
    ] as const;

    for (const [coord, color] of writes) {
      tile.setPixel(coord, color);
    }

    for (const [coord, color] of writes) {
      expect(tile.getPixel(coord)).toEqual(color);
    }
    expect(tile.getPixel({ x: 1, y: 1 })).toEqual(TRANSPARENT_BLACK);
  });

  it("returns a new color object for each read", () => {
    const tile = new Tile({ size: TILE_SIZE });
    tile.setPixel({ x: 1, y: 1 }, TEST_COLOR);

    const firstRead = tile.getPixel({ x: 1, y: 1 });
    firstRead.r = 0;

    expect(tile.getPixel({ x: 1, y: 1 })).toEqual(TEST_COLOR);
  });

  it.each([
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: TILE_SIZE, y: 0 },
    { x: 0, y: TILE_SIZE },
  ])("rejects out-of-bounds coordinate $x,$y", (coord) => {
    const tile = new Tile({ size: TILE_SIZE });
    const getPixel = () => tile.getPixel(coord);

    expect(getPixel).toThrow(ReverieRangeError);
    expect(getPixel).toThrow(
      `[${ErrorCodes.TILE.LOCAL_PIXEL_COORDINATE_OUT_OF_BOUNDS}]`,
    );
  });

  it.each([
    { x: 0.5, y: 0 },
    { x: 0, y: Number.NaN },
  ])("rejects unsafe coordinate $x,$y", (coord) => {
    const tile = new Tile({ size: TILE_SIZE });

    expect(() => tile.getPixel(coord)).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_COORDINATE_VALUE}]`,
    );
  });

  it.each([
    { r: -1, g: 0, b: 0, a: 0 },
    { r: 256, g: 0, b: 0, a: 0 },
    { r: 0.5, g: 0, b: 0, a: 0 },
    { r: Number.NaN, g: 0, b: 0, a: 0 },
    { r: 0, g: Number.POSITIVE_INFINITY, b: 0, a: 0 },
  ])("rejects invalid RGBA color $r,$g,$b,$a", (color) => {
    const tile = new Tile({ size: TILE_SIZE });
    const setPixel = () => tile.setPixel({ x: 0, y: 0 }, color);

    expect(setPixel).toThrow(ReverieRangeError);
    expect(setPixel).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    expect(tile.getPixel({ x: 0, y: 0 })).toEqual(TRANSPARENT_BLACK);
    expect(tile.dirtyBounds).toBeNull();
  });

  it("rejects structurally invalid colors at the public boundary", () => {
    const tile = new Tile({ size: TILE_SIZE });

    expect(() => {
      // @ts-expect-error Missing alpha verifies JavaScript callers at runtime.
      tile.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 0 });
    }).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
    expect(() => {
      // @ts-expect-error Null verifies JavaScript callers at runtime.
      tile.setPixel({ x: 0, y: 0 }, null);
    }).toThrow(`[${ErrorCodes.COMMON.INVALID_RGBA_COLOR}]`);
  });
});

describe("Tile dirty bounds", () => {
  it("expands to the smallest rectangle containing every changed pixel", () => {
    const tile = new Tile({ size: 32 });

    tile.setPixel({ x: 10, y: 20 }, TEST_COLOR);
    expect(tile.dirtyBounds).toEqual({ x: 10, y: 20, width: 1, height: 1 });

    tile.setPixel({ x: 15, y: 25 }, TEST_COLOR);
    expect(tile.dirtyBounds).toEqual({ x: 10, y: 20, width: 6, height: 6 });

    tile.setPixel({ x: 8, y: 18 }, TEST_COLOR);
    expect(tile.dirtyBounds).toEqual({ x: 8, y: 18, width: 8, height: 8 });
  });

  it("does not expose mutable dirty bounds state", () => {
    const tile = new Tile({ size: TILE_SIZE });
    tile.setPixel({ x: 1, y: 1 }, TEST_COLOR);

    const dirtyBounds = tile.dirtyBounds;
    if (dirtyBounds !== null) {
      dirtyBounds.width = TILE_SIZE;
    }

    expect(tile.dirtyBounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("resets dirty bounds without changing pixels", () => {
    const tile = new Tile({ size: TILE_SIZE });
    tile.setPixel({ x: 1, y: 1 }, TEST_COLOR);

    tile.resetDirtyBounds();

    expect(tile.dirtyBounds).toBeNull();
    expect(tile.getPixel({ x: 1, y: 1 })).toEqual(TEST_COLOR);
  });

  it("clears every pixel and marks the entire tile dirty", () => {
    const tile = new Tile({ size: TILE_SIZE });
    tile.setPixel({ x: 0, y: 0 }, TEST_COLOR);
    tile.setPixel({ x: TILE_SIZE - 1, y: TILE_SIZE - 1 }, TEST_COLOR);

    tile.clear();

    expect(tile.getPixel({ x: 0, y: 0 })).toEqual(TRANSPARENT_BLACK);
    expect(tile.getPixel({ x: TILE_SIZE - 1, y: TILE_SIZE - 1 })).toEqual(
      TRANSPARENT_BLACK,
    );
    expect(tile.dirtyBounds).toEqual({
      x: 0,
      y: 0,
      width: TILE_SIZE,
      height: TILE_SIZE,
    });
  });
});
