import { describe, expect, it } from "vitest";

import { Raster, World } from "@reverie/core";
import {
  getRasterTilePixels,
  getRasterTileVersion,
} from "@reverie/core/renderer";
import {
  deserializeRaster,
  parseDocument,
  parseRaster,
  serializeDocument,
  serializeRaster,
} from "@reverie/core/document";

describe("Raster serialization", () => {
  it("round-trips exact RGBA8 bytes, including transparent RGB channels", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 12, b: 34, a: 0 });
    raster.setPixel({ x: 1, y: 1 }, { r: 4, g: 5, b: 6, a: 7 });

    const serialized = serializeRaster(raster);
    const restored = deserializeRaster(serialized);

    expect(serialized).toMatchObject({
      tileSize: 2,
      pixelFormat: "rgba8",
      tiles: [{ x: 0, y: 0, payload: { encoding: "rgba8-raw" } }],
    });
    expect(getRasterTilePixels(restored, { x: 0, y: 0 })).toEqual(
      getRasterTilePixels(raster, { x: 0, y: 0 }),
    );
    expect(restored.getPixel({ x: 0, y: 0 })).toEqual({
      r: 255,
      g: 12,
      b: 34,
      a: 0,
    });
  });

  it(
    "preserves pixel semantics for missing and redundantly allocated empty Tiles",
    () => {
      const missingTileRaster = new Raster({ tileSize: 2 });
      const allocatedEmptyTileRaster = new Raster({ tileSize: 2 });
      allocatedEmptyTileRaster.setPixel({ x: 0, y: 0 }, {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      });

      const restoredMissingTileRaster = deserializeRaster(
        serializeRaster(missingTileRaster),
      );
      const restoredAllocatedEmptyTileRaster = deserializeRaster(
        serializeRaster(allocatedEmptyTileRaster),
      );

      for (const pixel of [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]) {
        expect(restoredAllocatedEmptyTileRaster.getPixel(pixel)).toEqual(
          restoredMissingTileRaster.getPixel(pixel),
        );
      }
    },
  );

  it("serializes only allocated tiles in deterministic tile-Y then tile-X order", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 4, y: -2 }, { r: 1, g: 2, b: 3, a: 4 });
    raster.setPixel({ x: -2, y: 0 }, { r: 5, g: 6, b: 7, a: 8 });
    raster.setPixel({ x: 0, y: 0 }, { r: 9, g: 10, b: 11, a: 12 });

    const serialized = serializeRaster(raster);
    const restored = deserializeRaster(serialized);

    expect(serialized.tiles.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 2, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(restored.allocatedTileCount).toBe(3);
    expect(getRasterTilePixels(restored, { x: 1, y: 1 })).toBeUndefined();
    expect(restored.getPixel({ x: 2, y: 2 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("keeps serialized and restored payload buffers independent from their sources", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 40 });
    const serialized = serializeRaster(raster);
    const payload = serialized.tiles[0].payload.data;

    raster.setPixel({ x: 0, y: 0 }, { r: 50, g: 60, b: 70, a: 80 });
    expect(payload.slice(0, 4)).toEqual(new Uint8Array([10, 20, 30, 40]));

    const restored = deserializeRaster(serialized);
    payload[0] = 200;
    expect(restored.getPixel({ x: 0, y: 0 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 40,
    });
  });

  it("does not persist runtime tile identity or revision state", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 4 });
    const sourceVersion = getRasterTileVersion(raster, { x: 0, y: 0 });
    const serialized = serializeRaster(raster);
    const restoredVersion = getRasterTileVersion(
      deserializeRaster(serialized),
      { x: 0, y: 0 },
    );

    expect(serialized.tiles[0]).not.toHaveProperty("tileId");
    expect(serialized.tiles[0]).not.toHaveProperty("revision");
    expect(restoredVersion?.tileId).not.toBe(sourceVersion?.tileId);
  });

  it.each([
    [
      "non-positive tile size",
      { tileSize: 0, pixelFormat: "rgba8", tiles: [] },
      "EC_DOCUMENT_0014",
    ],
    [
      "unsupported pixel format",
      { tileSize: 2, pixelFormat: "rgba16", tiles: [] },
      "EC_DOCUMENT_0010",
    ],
    [
      "unsupported encoding",
      createRasterFixture({ encoding: "png" }),
      "EC_DOCUMENT_0011",
    ],
    [
      "short payload",
      createRasterFixture({ data: new Uint8Array(15) }),
      "EC_DOCUMENT_0012",
    ],
    [
      "long payload",
      createRasterFixture({ data: new Uint8Array(17) }),
      "EC_DOCUMENT_0012",
    ],
    [
      "duplicate coordinate",
      createRasterFixture({ duplicate: true }),
      "EC_DOCUMENT_0013",
    ],
  ])("rejects $0 with a stable document error", (_scenario, input, code) => {
    expect(() => deserializeRaster(input)).toThrow(`[${code}]`);
  });

  it("integrates independent sparse Raster payloads into document schema parsing", () => {
    const world = new World({ id: "raster-document", tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: -1, y: -1 }, { r: 100, g: 110, b: 120, a: 130 });

    const serialized = serializeDocument(world);
    const parsed = parseDocument(serialized);
    serialized.world.layers[0].raster.tiles[0].payload.data[12] = 0;

    expect(parsed.world.layers[0].raster.tiles[0].payload.data[12]).toBe(100);
  });

  it("rejects a Layer Raster whose tile size cannot belong to its World", () => {
    const document = serializeDocument(new World({ tileSize: 2 }));
    const invalidDocument = {
      ...document,
      world: {
        ...document.world,
        layers: [
          {
            ...document.world.layers[0],
            raster: { tileSize: 4, pixelFormat: "rgba8", tiles: [] },
          },
        ],
      },
    };

    expect(() => parseDocument(invalidDocument)).toThrow("[EC_DOCUMENT_0009]");
  });
});

function createRasterFixture(
  options: {
    readonly encoding?: string;
    readonly data?: Uint8Array;
    readonly duplicate?: boolean;
  } = {},
): unknown {
  const tile = {
    x: -1,
    y: 2,
    payload: {
      encoding: options.encoding ?? "rgba8-raw",
      data: options.data ?? new Uint8Array(16),
    },
  };
  return {
    tileSize: 2,
    pixelFormat: "rgba8",
    tiles: options.duplicate ? [tile, { ...tile }] : [tile],
  };
}
