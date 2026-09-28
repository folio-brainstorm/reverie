import { describe, expect, it } from "vitest";

import { Raster, World } from "@reveriejs/core";
import { serializeRaster } from "@reveriejs/core/document";
import { DocumentHistory } from "@reveriejs/core/history";
import {
  getRasterTilePixels,
  getRasterTileVersion,
  getRasterTileView,
} from "@reveriejs/core/rendering/internal";

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

describe("explicit Raster cleanup", () => {
  it("clears a Layer without changing its identity or metadata and supports Undo", () => {
    const world = new World({ tileSize: 2 });
    const layer = world.getLayer(0);
    layer.name = "Ink";
    layer.visible = false;
    layer.opacity = 0.4;
    layer.blendMode = "multiply";
    layer.raster.setPixel({ x: 0, y: 0 }, RED);
    layer.raster.setPixel({ x: 2, y: 0 }, BLUE);
    const history = new DocumentHistory({ world });

    history.performRasterMutation(layer.raster, () => layer.clear());

    expect(world.getLayer(0)).toBe(layer);
    expect(layer.name).toBe("Ink");
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(0.4);
    expect(layer.blendMode).toBe("multiply");
    expect(layer.raster.allocatedTileCount).toBe(0);
    expect(history.canUndo).toBe(true);

    history.undo();

    expect(layer.raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
    expect(layer.raster.getPixel({ x: 2, y: 0 })).toEqual(BLUE);
  });

  it("does not record or allocate storage when clearing an empty Layer", () => {
    const world = new World({ tileSize: 2 });
    const layer = world.getLayer(0);
    const history = new DocumentHistory({ world });

    history.performRasterMutation(layer.raster, () => layer.clear());

    expect(layer.raster.allocatedTileCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it("releases only fully covered allocated Tiles and clears hidden RGB in partial Tiles", () => {
    const raster = new Raster({ tileSize: 2 });
    const deletedTile = { x: 0, y: 0 };
    const retainedTile = { x: 1, y: 0 };
    raster.setPixel({ x: 0, y: 0 }, RED);
    raster.setPixel({ x: 2, y: 0 }, { r: 10, g: 20, b: 30, a: 0 });
    raster.setPixel({ x: 3, y: 1 }, BLUE);

    raster.clearRegion({ x: 0, y: 0, width: 3, height: 2 });

    expect(raster.allocatedTileCount).toBe(1);
    expect(getRasterTilePixels(raster, deletedTile)).toBeUndefined();
    expect(getRasterTileVersion(raster, deletedTile)).toBeUndefined();
    expect(getRasterTileView(raster, deletedTile)).toBeUndefined();
    expect(raster.getPixel({ x: 2, y: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(getRasterTileView(raster, retainedTile)).toBeDefined();
    expect(raster.getPixel({ x: 3, y: 1 })).toEqual(BLUE);
  });

  it("does not allocate or record a clear region without matching storage", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    const history = new DocumentHistory();

    history.performRasterMutation(raster, () => {
      raster.clearRegion({ x: 10, y: 10, width: 2, height: 2 });
    });

    expect(raster.allocatedTileCount).toBe(1);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
    expect(history.canUndo).toBe(false);
  });

  it("restores deleted and partially cleared Tiles through Undo", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    raster.setPixel({ x: 2, y: 0 }, { r: 10, g: 20, b: 30, a: 0 });
    raster.setPixel({ x: 3, y: 1 }, BLUE);
    const history = new DocumentHistory();

    history.performRasterMutation(raster, () => {
      raster.clearRegion({ x: 0, y: 0, width: 3, height: 2 });
    });

    expect(raster.allocatedTileCount).toBe(1);
    history.undo();

    expect(raster.allocatedTileCount).toBe(2);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
    expect(raster.getPixel({ x: 2, y: 0 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0,
    });
    expect(raster.getPixel({ x: 3, y: 1 })).toEqual(BLUE);
  });

  it("removes a fully covered Tile at negative coordinates", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: -2, y: -2 }, RED);
    raster.setPixel({ x: -1, y: -1 }, BLUE);
    raster.setPixel({ x: 0, y: 0 }, RED);

    raster.clearRegion({ x: -2, y: -2, width: 2, height: 2 });

    expect(raster.allocatedTileCount).toBe(1);
    expect(raster.getPixel({ x: -2, y: -2 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: 0 },
    { x: 0, y: 0, width: -1, height: 1 },
    { x: 0, y: 0, width: 1, height: -1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 2, height: 1 },
  ])("rejects invalid clear region bounds %j", (bounds) => {
    const raster = new Raster({ tileSize: 2 });

    expect(() => raster.clearRegion(bounds)).toThrow();
    expect(raster.allocatedTileCount).toBe(0);
  });

  it("omits deleted Tiles from serialization", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    raster.setPixel({ x: 2, y: 0 }, BLUE);

    raster.clearRegion({ x: 0, y: 0, width: 2, height: 2 });

    expect(
      serializeRaster(raster).tiles.map((tile) => [tile.x, tile.y]),
    ).toEqual([[1, 0]]);
  });
});
