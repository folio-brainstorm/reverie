import { describe, expect, it } from "vitest";

import { Raster } from "@reverie/core";
import {
  getRasterTilePixels,
} from "@reverie/core/renderer";
import type { Renderer, TileCoord } from "@reverie/core/renderer";

const TILE_SIZE = 2;

describe("Raster renderer bridge", () => {
  it("is available through the dedicated core renderer entry point", () => {
    const coord: TileCoord = { x: 0, y: 0 };
    const renderer: Renderer = { render: () => undefined };
    const raster = new Raster({ tileSize: TILE_SIZE });

    renderer.render();

    expect(getRasterTilePixels(raster, coord)).toBeUndefined();
  });

  it("reads an allocated tile in row-major RGBA8 order", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    raster.setPixel(
      { x: 0, y: 0 },
      { r: 255, g: 64, b: 32, a: 255 },
    );
    raster.setPixel(
      { x: 1, y: 1 },
      { r: 10, g: 20, b: 30, a: 40 },
    );

    const pixels = getRasterTilePixels(raster, { x: 0, y: 0 });

    expect(Array.from(pixels ?? [])).toEqual([
      255, 64, 32, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      10, 20, 30, 40,
    ]);
  });

  it("resolves negative tile coordinates", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    raster.setPixel(
      { x: -1, y: -1 },
      { r: 128, g: 96, b: 64, a: 255 },
    );

    const pixels = getRasterTilePixels(raster, { x: -1, y: -1 });

    expect(Array.from(pixels ?? []).slice(12)).toEqual([128, 96, 64, 255]);
  });

  it("returns independent snapshots that cannot mutate Raster state", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    const pixel = { x: 0, y: 0 };
    const color = { r: 1, g: 2, b: 3, a: 255 };
    raster.setPixel(pixel, color);

    const firstSnapshot = getRasterTilePixels(raster, { x: 0, y: 0 });
    const secondSnapshot = getRasterTilePixels(raster, { x: 0, y: 0 });

    expect(firstSnapshot).toBeDefined();
    expect(secondSnapshot).toBeDefined();
    expect(firstSnapshot).not.toBe(secondSnapshot);

    if (firstSnapshot !== undefined) {
      firstSnapshot[0] = 200;
    }

    expect(raster.getPixel(pixel)).toEqual(color);
    expect(secondSnapshot?.[0]).toBe(1);
  });

  it("does not allocate storage while reading an absent tile", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });

    expect(
      getRasterTilePixels(raster, { x: 500_000, y: -500_000 }),
    ).toBeUndefined();
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });
});
