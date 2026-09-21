import { describe, expect, it } from "vitest";

import { Raster, RasterLayer, World } from "@reverie/core";
import { getRasterTilePixels } from "@reverie/core/renderer";
import { deserializeDocument, serializeDocument } from "@reverie/core/document";

describe("Document runtime hydration", () => {
  it("restores a bounded World, ordered Layer metadata, sparse tiles, and stable identities", () => {
    const source = createDocumentWorld();
    const sourceDocument = serializeDocument(source);

    const hydrated = deserializeDocument(sourceDocument);

    expect(hydrated).not.toBe(source);
    expect(hydrated.id).toBe(source.id);
    expect(hydrated.tileSize).toBe(2);
    expect(hydrated.bounds).toEqual({ x: -4, y: -4, width: 12, height: 12 });
    expect(hydrated.layers).toHaveLength(2);
    expect(hydrated.layers.map((layer) => layer.id)).toEqual(
      source.layers.map((layer) => layer.id),
    );
    expect(hydrated.layers.map((layer) => layer.name)).toEqual([
      "Background",
      "Ink",
    ]);
    expect(hydrated.layers.map((layer) => layer.visible)).toEqual([
      true,
      false,
    ]);
    expect(hydrated.layers.map((layer) => layer.opacity)).toEqual([1, 0.4]);
    expect(hydrated.layers.map((layer) => layer.blendMode)).toEqual([
      "normal",
      "multiply",
    ]);
    expect(
      getRasterTilePixels(hydrated.layers[0].raster, { x: -1, y: -1 }),
    ).toEqual(getRasterTilePixels(source.layers[0].raster, { x: -1, y: -1 }));
    expect(hydrated.layers[0].raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(
      getRasterTilePixels(hydrated.layers[1].raster, { x: 2, y: 2 }),
    ).toEqual(getRasterTilePixels(source.layers[1].raster, { x: 2, y: 2 }));
  });

  it("keeps runtime and serialized Raster bytes isolated in both directions", () => {
    const source = createDocumentWorld();
    const document = serializeDocument(source);
    const hydrated = deserializeDocument(document);
    const payload = document.world.layers[0].raster.tiles[0].payload.data;

    source.layers[0].raster.setPixel(
      { x: -1, y: -1 },
      { r: 1, g: 2, b: 3, a: 4 },
    );
    expect(payload.slice(12, 16)).toEqual(new Uint8Array([255, 0, 0, 0]));

    payload[12] = 7;
    expect(hydrated.layers[0].raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("produces semantically stable current documents through a double round-trip", () => {
    const source = createDocumentWorld();
    const first = serializeDocument(source);
    const second = serializeDocument(deserializeDocument(first));

    expect(second).toEqual(first);
  });

  it("rejects malformed input without mutating an unrelated runtime World", () => {
    const existing = new World({ id: "existing-world", tileSize: 2 });
    existing
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 9, g: 8, b: 7, a: 6 });
    const serialized = serializeDocument(createDocumentWorld());
    const invalidLayer = serialized.world.layers[1];
    if (invalidLayer === undefined) {
      throw new Error("Expected a second serialized Layer.");
    }
    const invalidTile = invalidLayer.raster.tiles[0];
    if (invalidTile === undefined) {
      throw new Error("Expected an allocated second-Layer tile.");
    }
    const invalidDocument = {
      ...serialized,
      world: {
        ...serialized.world,
        layers: [
          serialized.world.layers[0],
          {
            ...invalidLayer,
            raster: {
              ...invalidLayer.raster,
              tiles: [
                {
                  ...invalidTile,
                  payload: {
                    ...invalidTile.payload,
                    data: new Uint8Array(1),
                  },
                },
              ],
            },
          },
        ],
      },
    };

    expect(() => deserializeDocument(invalidDocument)).toThrow(
      "[EC_DOCUMENT_0012]",
    );
    expect(existing.id).toBe("existing-world");
    expect(existing.layers).toHaveLength(1);
    expect(existing.getLayer(0).raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 9,
      g: 8,
      b: 7,
      a: 6,
    });
  });

  it("passes required-feature capability checks through the normalization boundary", () => {
    const document = {
      ...serializeDocument(createDocumentWorld()),
      requiredFeatures: ["layer-mask-v1"],
    };

    expect(() => deserializeDocument(document)).toThrow("[EC_DOCUMENT_0004]");
    expect(
      deserializeDocument(document, {
        supportedFeatures: ["layer-mask-v1"],
      }),
    ).toBeInstanceOf(World);
  });

  it("hydrates a serialized Layer ID that matches the historical fallback namespace", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 4 });
    const layer = new RasterLayer(raster, null, "layer-1");
    layer.name = "Fallback Layer";
    const source = new World({
      id: "fallback-world",
      tileSize: 2,
      initialLayers: [layer],
    });

    const hydrated = deserializeDocument(serializeDocument(source));

    expect(hydrated.layers).toHaveLength(1);
    expect(hydrated.getLayer(0).id).toBe("layer-1");
    expect(hydrated.getLayer(0).raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 4,
    });
  });
});

function createDocumentWorld(): World {
  const world = new World({
    id: "hydration-world",
    tileSize: 2,
    bounds: { x: -4, y: -4, width: 12, height: 12 },
  });
  const background = world.getLayer(0);
  background.name = "Background";
  background.raster.setPixel({ x: -1, y: -1 }, { r: 255, g: 0, b: 0, a: 0 });
  const ink = world.addLayer();
  ink.name = "Ink";
  ink.visible = false;
  ink.opacity = 0.4;
  ink.blendMode = "multiply";
  ink.raster.setPixel({ x: 2, y: 2 }, { r: 1, g: 2, b: 3, a: 4 });
  return world;
}
