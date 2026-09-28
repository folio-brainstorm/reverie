import { describe, expect, it } from "vitest";

import { Raster } from "@reverie/core";
import type { Renderer as RootRenderer } from "@reverie/core";
import {
  getRasterTilePixels,
  getRasterTileVersion,
  getRasterTileView,
} from "@reverie/core/rendering/internal";
import type { Renderer, TileCoord } from "@reverie/core/rendering";

const TILE_SIZE = 2;

describe("Raster renderer bridge", () => {
  it("is available through the dedicated internal rendering entry point", () => {
    const coord: TileCoord = { x: 0, y: 0 };
    const renderer: Renderer = {
      render: () => undefined,
      resize: () => undefined,
      dispose: () => undefined,
    };
    const rootRenderer: RootRenderer = renderer;
    const raster = new Raster({ tileSize: TILE_SIZE });

    renderer.render();
    rootRenderer.resize(100, 100);
    rootRenderer.dispose();

    expect(getRasterTilePixels(raster, coord)).toBeUndefined();
  });

  it("reads an allocated tile in row-major RGBA8 order", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 64, b: 32, a: 255 });
    raster.setPixel({ x: 1, y: 1 }, { r: 10, g: 20, b: 30, a: 40 });

    const pixels = getRasterTilePixels(raster, { x: 0, y: 0 });

    expect(Array.from(pixels ?? [])).toEqual([
      255, 64, 32, 255, 0, 0, 0, 0, 0, 0, 0, 0, 10, 20, 30, 40,
    ]);
  });

  it("resolves negative tile coordinates", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    raster.setPixel({ x: -1, y: -1 }, { r: 128, g: 96, b: 64, a: 255 });

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

  it("exposes a live zero-copy view over an allocated tile", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    const pixel = { x: 0, y: 0 };
    raster.setPixel(pixel, { r: 10, g: 20, b: 30, a: 255 });

    const view = getRasterTileView(raster, { x: 0, y: 0 });

    expect(view).toBeDefined();
    expect(view?.pixels[0]).toBe(10);

    raster.setPixel(pixel, { r: 200, g: 20, b: 30, a: 255 });

    expect(view?.pixels[0]).toBe(200);
  });

  it("reports the same tile identity and revision as the version query", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    const coord: TileCoord = { x: 1, y: -1 };
    raster.setPixel({ x: 2, y: -1 }, { r: 1, g: 2, b: 3, a: 4 });

    const view = getRasterTileView(raster, coord);
    const version = getRasterTileVersion(raster, coord);

    expect(view).toBeDefined();
    expect(version).toBeDefined();
    expect(view?.tileId).toBe(version?.tileId);
    expect(view?.revision).toBe(version?.revision);
  });

  it("returns undefined for an absent tile without allocating storage", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });

    expect(
      getRasterTileView(raster, { x: 500_000, y: -500_000 }),
    ).toBeUndefined();
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("makes cleared Tile state unavailable to renderer-facing queries", () => {
    const raster = new Raster({ tileSize: TILE_SIZE });
    const coord: TileCoord = { x: 0, y: 0 };
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 40 });

    expect(getRasterTileVersion(raster, coord)).toBeDefined();
    raster.clear();

    expect(getRasterTilePixels(raster, coord)).toBeUndefined();
    expect(getRasterTileVersion(raster, coord)).toBeUndefined();
    expect(getRasterTileView(raster, coord)).toBeUndefined();
  });

  it("keeps hidden RGB distinct from a canonical-empty Tile payload", () => {
    const emptyRaster = new Raster({ tileSize: TILE_SIZE });
    const hiddenRgbRaster = new Raster({ tileSize: TILE_SIZE });
    emptyRaster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    hiddenRgbRaster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 0 });

    expect(
      Array.from(getRasterTilePixels(emptyRaster, { x: 0, y: 0 }) ?? []),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(
      Array.from(getRasterTilePixels(hiddenRgbRaster, { x: 0, y: 0 }) ?? []),
    ).toEqual([
      255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});
