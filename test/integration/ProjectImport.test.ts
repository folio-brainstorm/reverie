import { describe, expect, it } from "vitest";

import { World } from "@reveriejs/core";
import { serializeDocument } from "@reveriejs/core/document";
import {
  encodeProjectContainer,
  exportProject,
  importProject,
} from "@reveriejs/core/project";

describe("Project import", () => {
  it("restores an independent World with equivalent document semantics", () => {
    const source = createSourceWorld();
    const expected = serializeDocument(source);

    const imported = importProject(exportProject(source));

    expect(imported).not.toBe(source);
    expect(serializeDocument(imported)).toEqual(expected);
  });

  it("creates independent Worlds for separate imports of the same project bytes", () => {
    const bytes = exportProject(createSourceWorld());
    const first = importProject(bytes);
    const second = importProject(bytes);

    first.getLayer(0).raster.setPixel(
      { x: -1, y: -1 },
      {
        r: 255,
        g: 0,
        b: 0,
        a: 255,
      },
    );

    expect(second.getLayer(0).raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 12,
      g: 24,
      b: 36,
      a: 0,
    });
  });

  it("keeps imported Raster state independent from later input-byte mutations", () => {
    const bytes = exportProject(createSourceWorld());
    const imported = importProject(bytes);
    bytes.fill(0);

    expect(imported.getLayer(1).raster.getPixel({ x: 3, y: 2 })).toEqual({
      r: 255,
      g: 128,
      b: 64,
      a: 255,
    });
  });

  it("preserves unbounded Worlds, negative coordinates, and transparent RGB", () => {
    const source = new World({ id: "unbounded-import", tileSize: 2 });
    source.getLayer(0).raster.setPixel(
      { x: -3, y: -5 },
      {
        r: 1,
        g: 2,
        b: 3,
        a: 0,
      },
    );

    const imported = importProject(exportProject(source));

    expect(imported.bounds).toBeNull();
    expect(imported.getLayer(0).raster.getPixel({ x: -3, y: -5 })).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 0,
    });
  });

  it("ignores an optional preview while restoring the authoritative document", () => {
    const source = createSourceWorld();
    const bytes = exportProject(source, {
      preview: {
        mimeType: "image/png",
        data: new Uint8Array([137, 80, 78, 71]),
      },
    });

    expect(serializeDocument(importProject(bytes))).toEqual(
      serializeDocument(source),
    );
  });

  it("requires host-declared support before importing a feature-bearing project", () => {
    const source = createSourceWorld();
    const expected = serializeDocument(source);
    const document = {
      ...expected,
      requiredFeatures: ["feature-alpha"],
    };
    const bytes = encodeProjectContainer(document);

    expect(() => importProject(bytes)).toThrow("[EC_DOCUMENT_0004]");
    expect(
      serializeDocument(
        importProject(bytes, { supportedFeatures: ["feature-alpha"] }),
      ),
    ).toEqual(expected);
  });

  it("propagates precise project-container failures without producing a World", () => {
    expect(() => importProject(new Uint8Array([1, 2, 3, 4]))).toThrow(
      "[EC_PROJECT_0001]",
    );
  });
});

function createSourceWorld(): World {
  const world = new World({
    id: "import-project",
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
