import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  ReverieRangeError,
  World,
} from "@reverie/core";
import type { Brush, RGBAColor, WorldBounds } from "@reverie/core";

const OPAQUE_BLUE: RGBAColor = { r: 20, g: 80, b: 240, a: 255 };
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };

describe("World bounds", () => {
  it("defaults to an infinite World and accepts every valid pixel", () => {
    const world = new World();

    expect(world.bounds).toBeNull();
    expect(world.containsPixel({ x: 0, y: 0 })).toBe(true);
    expect(
      world.containsPixel({
        x: Number.MIN_SAFE_INTEGER,
        y: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });

  it("uses half-open finite bounds", () => {
    const world = new World({
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    });

    expect(world.containsPixel({ x: 10, y: 20 })).toBe(true);
    expect(world.containsPixel({ x: 109, y: 69 })).toBe(true);
    expect(world.containsPixel({ x: 110, y: 69 })).toBe(false);
    expect(world.containsPixel({ x: 109, y: 70 })).toBe(false);
    expect(world.containsPixel({ x: 9, y: 20 })).toBe(false);
  });

  it("supports a negative origin", () => {
    const world = new World({
      bounds: { x: -100, y: -100, width: 200, height: 200 },
    });

    expect(world.containsPixel({ x: -100, y: -100 })).toBe(true);
    expect(world.containsPixel({ x: 99, y: 99 })).toBe(true);
    expect(world.containsPixel({ x: 100, y: 99 })).toBe(false);
  });

  it("owns its bounds instead of retaining mutable external state", () => {
    const bounds = { x: 1, y: 2, width: 3, height: 4 };
    const world = new World({ bounds });

    bounds.width = 100;
    const exposedBounds = world.bounds;

    expect(exposedBounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(exposedBounds).not.toBe(bounds);
  });

  it.each([
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: -1, height: 1 },
    { x: 0, y: 0, width: 1.5, height: 1 },
    { x: 0, y: 0, width: 1, height: 0 },
    { x: 0, y: 0, width: 1, height: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid bounds $x,$y,$width,$height", (bounds) => {
    const createWorld = () => new World({ bounds });

    expect(createWorld).toThrow(ReverieRangeError);
    expect(createWorld).toThrow(`[${ErrorCodes.WORLD.INVALID_BOUNDS}]`);
  });

  it("rejects a non-numeric bounds component at runtime", () => {
    const createWorld = () =>
      new World({
        bounds: {
          // @ts-expect-error Runtime validation protects JavaScript callers.
          x: "0",
          y: 0,
          width: 1,
          height: 1,
        },
      });

    expect(createWorld).toThrow(`[${ErrorCodes.WORLD.INVALID_BOUNDS}]`);
  });

  it("rejects an invalid coordinate before containment testing", () => {
    const world = new World();

    expect(() => world.containsPixel({ x: -1, y: Number.NaN })).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_COORDINATE_VALUE}]`,
    );
  });
});

describe("RasterLayer bounded painting", () => {
  it("clips a CircleBrush that crosses the World boundary", () => {
    const world = new World({
      tileSize: 16,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const layer = world.createRasterLayer();
    const brush = new CircleBrush({ size: 20, color: OPAQUE_BLUE });

    layer.stamp(brush, { x: 98, y: 50 });

    expect(layer.raster.getPixel({ x: 99, y: 50 })).toEqual(OPAQUE_BLUE);
    expect(layer.raster.getPixel({ x: 100, y: 50 })).toEqual(
      TRANSPARENT_BLACK,
    );
  });

  it("does not allocate a tile for a stamp wholly outside finite bounds", () => {
    const world = new World({
      tileSize: 8,
      bounds: { x: 0, y: 0, width: 8, height: 8 },
    });
    const layer = world.createRasterLayer();
    const brush = new CircleBrush({ size: 10, color: OPAQUE_BLUE });

    layer.stamp(brush, { x: 10_000, y: 10_000 });

    // #if DEBUG
    expect(layer.raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("does not allocate an adjacent tile for the clipped part of a stamp", () => {
    const world = new World({
      tileSize: 8,
      bounds: { x: 0, y: 0, width: 8, height: 8 },
    });
    const layer = world.createRasterLayer();
    const brush = new CircleBrush({ size: 4, color: OPAQUE_BLUE });

    layer.stamp(brush, { x: 7.5, y: 4.5 });

    expect(layer.raster.getPixel({ x: 7, y: 4 })).toEqual(OPAQUE_BLUE);
    expect(layer.raster.getPixel({ x: 8, y: 4 })).toEqual(
      TRANSPARENT_BLACK,
    );
    // #if DEBUG
    expect(layer.raster.allocatedTileCount).toBe(1);
    // #endif
  });

  it("clips custom Brushes that use public Raster writes", () => {
    const world = new World({
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    const layer = world.createRasterLayer();
    const brush: Brush = {
      size: 1,
      spacing: 1,
      stamp(raster): void {
        raster.setPixel({ x: 0, y: 0 }, OPAQUE_BLUE);
        raster.setPixel({ x: 1, y: 0 }, OPAQUE_BLUE);
      },
    };

    layer.stamp(brush, { x: 0.5, y: 0.5 });

    expect(layer.raster.getPixel({ x: 0, y: 0 })).toEqual(OPAQUE_BLUE);
    expect(layer.raster.getPixel({ x: 1, y: 0 })).toEqual(
      TRANSPARENT_BLACK,
    );
  });

  it("preserves infinite painting and direct low-level Raster writes", () => {
    const infiniteLayer = new World().createRasterLayer();
    const fixedLayer = new World({
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    }).createRasterLayer();
    const brush = new CircleBrush({ size: 1, color: OPAQUE_BLUE });

    infiniteLayer.stamp(brush, { x: -100.5, y: 200.5 });
    fixedLayer.raster.setPixel({ x: 100, y: 100 }, OPAQUE_BLUE);

    expect(infiniteLayer.raster.getPixel({ x: -101, y: 200 })).toEqual(
      OPAQUE_BLUE,
    );
    expect(fixedLayer.raster.getPixel({ x: 100, y: 100 })).toEqual(
      OPAQUE_BLUE,
    );
  });

  it("exposes the WorldBounds contract through the package entry point", () => {
    const bounds: WorldBounds = { x: 0, y: 0, width: 16, height: 16 };
    const layer = new World({ bounds }).createRasterLayer();

    expect(layer.bounds).toEqual(bounds);
  });
});
