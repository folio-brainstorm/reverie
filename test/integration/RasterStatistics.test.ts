import { describe, expect, it } from "vitest";

import { Raster, World } from "@reverie/core";

const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };
const HIDDEN_RED = { r: 255, g: 0, b: 0, a: 0 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

describe("Raster sparse-storage statistics", () => {
  it("reports zero storage and no bounds for an empty Raster", () => {
    const raster = new Raster({ tileSize: 2 });

    expect(raster.getStatistics()).toEqual({
      tileCount: 0,
      rawPixelBytes: 0,
      tileBounds: null,
    });
  });

  it("counts allocated transparent and hidden-RGB Tiles without inspecting pixels", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, TRANSPARENT);
    raster.setPixel({ x: -1, y: 2 }, HIDDEN_RED);

    expect(raster.getStatistics()).toEqual({
      tileCount: 2,
      rawPixelBytes: 32,
      tileBounds: { minX: -1, minY: 0, maxX: 0, maxY: 1 },
    });
  });

  it("updates allocated bounds and raw payload bytes after cleanup removes Tiles", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: -2, y: 0 }, BLUE);
    raster.setPixel({ x: 0, y: 0 }, BLUE);
    raster.setPixel({ x: 2, y: 0 }, BLUE);

    raster.clearRegion({ x: -2, y: 0, width: 2, height: 2 });

    expect(raster.getStatistics()).toEqual({
      tileCount: 2,
      rawPixelBytes: 32,
      tileBounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
    });

    raster.clear();

    expect(raster.getStatistics()).toEqual({
      tileCount: 0,
      rawPixelBytes: 0,
      tileBounds: null,
    });
  });
});

describe("World Raster statistics", () => {
  it("aggregates current Layer Rasters in document order", () => {
    const world = new World({ tileSize: 2 });
    const firstLayer = world.getLayer(0);
    const secondLayer = world.addLayer();
    firstLayer.raster.setPixel({ x: 0, y: 0 }, BLUE);
    secondLayer.raster.setPixel({ x: 2, y: 0 }, HIDDEN_RED);

    expect(world.getRasterStatistics()).toEqual({
      tileCount: 2,
      rawPixelBytes: 32,
      layers: [
        {
          id: firstLayer.id,
          statistics: {
            tileCount: 1,
            rawPixelBytes: 16,
            tileBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          },
        },
        {
          id: secondLayer.id,
          statistics: {
            tileCount: 1,
            rawPixelBytes: 16,
            tileBounds: { minX: 1, minY: 0, maxX: 1, maxY: 0 },
          },
        },
      ],
    });
  });
});
