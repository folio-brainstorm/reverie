import { describe, expect, it } from "vitest";

import { World } from "@reverie/core";
import {
  deserializeDocument,
  serializeDocument,
} from "@reverie/core/document";
import {
  decodeProjectContainer,
  exportProject,
} from "@reverie/core/project";

describe("Project export", () => {
  it("exports a complete editable World through the document and container pipeline", () => {
    const world = createPaintedWorld();
    const expected = serializeDocument(world);

    const project = exportProject(world);
    const decoded = decodeProjectContainer(project);
    const restored = deserializeDocument(decoded);

    expect(decoded).toEqual(expected);
    expect(serializeDocument(restored)).toEqual(expected);
  });

  it("rejects empty Worlds, including Worlds with multiple empty Layers", () => {
    const oneEmptyLayer = new World({ id: "empty-project", tileSize: 2 });
    const multipleEmptyLayers = new World({
      id: "multiple-empty-project",
      tileSize: 2,
    });
    multipleEmptyLayers.addLayer();

    expect(() => exportProject(oneEmptyLayer)).toThrow("[EC_PROJECT_0008]");
    expect(() => exportProject(multipleEmptyLayers)).toThrow(
      "[EC_PROJECT_0008]",
    );
  });

  it("preserves transparent RGB data and negative Tile coordinates as stored document state", () => {
    const world = new World({ id: "transparent-project", tileSize: 2 });
    const layer = world.getLayer(0);
    layer.raster.setPixel({ x: -1, y: -1 }, { r: 14, g: 28, b: 42, a: 0 });

    const restored = deserializeDocument(
      decodeProjectContainer(exportProject(world)),
    );

    expect(restored.getLayer(0).raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 14,
      g: 28,
      b: 42,
      a: 0,
    });
  });

  it("captures a stable snapshot without mutating the source World", () => {
    const world = createPaintedWorld();
    const before = serializeDocument(world);
    const project = exportProject(world);

    world.getLayer(0).raster.setPixel({ x: -1, y: -1 }, {
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });

    expect(decodeProjectContainer(project)).toEqual(before);
    expect(serializeDocument(world)).not.toEqual(before);
  });

  it("packages an optional preview without making it document content", () => {
    const world = createPaintedWorld();
    const preview = new Uint8Array([9, 8, 7, 6]);
    const bytes = exportProject(world, {
      preview: { mimeType: "image/webp", data: preview },
    });
    preview[0] = 0;

    const entries = readEntries(bytes);
    const previewEntry = [...entries.entries()].find(([name]) =>
      name.startsWith("preview/"),
    );

    expect(previewEntry?.[1]).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(decodeProjectContainer(bytes)).toEqual(serializeDocument(world));
  });
});

function createPaintedWorld(): World {
  const world = new World({
    id: "export-project",
    tileSize: 2,
    bounds: { x: -4, y: -4, width: 12, height: 12 },
  });
  const background = world.getLayer(0);
  background.name = "Background";
  background.raster.setPixel({ x: -1, y: -1 }, { r: 12, g: 24, b: 36, a: 0 });

  const ink = world.addLayer();
  ink.name = "Ink";
  ink.visible = false;
  ink.opacity = 0.45;
  ink.blendMode = "multiply";
  ink.raster.setPixel({ x: 3, y: 2 }, { r: 255, g: 128, b: 64, a: 255 });
  return world;
}

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  const count = view.getUint32(4, true);
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint32(offset, true);
    offset += 4;
    const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    entries.set(name, bytes.slice(offset, offset + dataLength));
    offset += dataLength;
  }
  return entries;
}
