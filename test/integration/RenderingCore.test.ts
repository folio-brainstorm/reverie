import {
  Raster,
  ReverieRangeError,
  ReverieTypeError,
  World,
} from "@reverie/core";
import {
  compositeRgbaSourceOverInPlace,
  getRasterTileView,
  RenderingCore,
  type RenderContext,
  type RendererBackend,
  type RenderRegionSet,
  type RenderTarget,
} from "@reverie/core/renderer";
import { describe, expect, it } from "vitest";

const context: RenderContext = {};

describe("RenderingCore", () => {
  it("returns independent RGBA8 pixels for a visible Raster tile", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 12, g: 34, b: 56, a: 255 });

    const regions = new RenderingCore().render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    });

    expect(regions.regions).toHaveLength(1);
    expect(regions.regions[0]?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    });
    expect(regions.regions[0]?.pixels).toBeInstanceOf(Uint8Array);
    expect(Array.from(regions.regions[0]?.pixels ?? [])).toEqual([
      12, 34, 56, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    expect(Array.from(regions.regions[0]?.pixels ?? []).slice(0, 4)).toEqual([
      12, 34, 56, 255,
    ]);
  });

  it("matches the pre-migration Canvas composition baseline for a fixed World fixture", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 100, g: 100, b: 100, a: 255 });
    top.raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 150, b: 50, a: 255 });
    top.opacity = 0.5;
    top.blendMode = "multiply";

    const expected = composeLegacyWorldTile(world);
    const regions = new RenderingCore().render({
      source: { world },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    });

    expect(regions.regions).toHaveLength(1);
    expect(Array.from(regions.regions[0]?.pixels ?? [])).toEqual(
      Array.from(expected),
    );
  });

  it("excludes hidden and transparent World layers from final pixels", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 255 });
    top.raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 100, b: 50, a: 255 });
    top.visible = false;

    const hiddenPixels = new RenderingCore().render({
      source: { world },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    }).regions[0]?.pixels;
    top.visible = true;
    top.opacity = 0;
    const transparentPixels = new RenderingCore().render({
      source: { world },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    }).regions[0]?.pixels;

    expect(Array.from(hiddenPixels ?? [])).toEqual(
      Array.from(transparentPixels ?? []),
    );
    expect(Array.from(hiddenPixels ?? []).slice(0, 4)).toEqual([
      10, 20, 30, 255,
    ]);
  });

  it("generates filtered lower-resolution pixels when output scale is below one", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 1, y: 0 }, { r: 0, g: 255, b: 0, a: 0 });

    const regions = new RenderingCore().render({
      source: { raster },
      context: { scale: 0.25 },
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    });

    expect(Array.from(regions.regions[0]?.pixels ?? [])).toEqual([
      255, 0, 0, 64,
    ]);
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 2 },
    { x: 0, y: 0, width: 2, height: 0 },
  ])("returns no regions for a zero-area viewport", (viewport) => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });

    expect(
      new RenderingCore().render({ source: { raster }, context, viewport }),
    ).toEqual({ regions: [] });
  });

  it.each([
    { x: 0, y: 0, width: -1, height: 1 },
    { x: 0, y: 0, width: 1, height: -1 },
    { x: Infinity, y: 0, width: 1, height: 1 },
  ])("rejects an invalid viewport range", (viewport) => {
    const raster = new Raster({ tileSize: 2 });

    expect(() =>
      new RenderingCore().render({ source: { raster }, context, viewport }),
    ).toThrow(ReverieRangeError);
  });

  it("rejects a non-number viewport component", () => {
    const request: unknown = {
      source: { raster: new Raster({ tileSize: 2 }) },
      context,
      viewport: { x: 0, y: 0, width: "1", height: 1 },
    };

    expect(() =>
      Reflect.apply(new RenderingCore().render, new RenderingCore(), [request]),
    ).toThrow(ReverieTypeError);
  });

  it("allows a backend to receive only resolved regions and its target", () => {
    const target: RenderTarget = {};
    const regions: RenderRegionSet = { regions: [] };
    let presentedRegions: RenderRegionSet | undefined;
    let presentedTarget: RenderTarget | undefined;
    const backend: RendererBackend = {
      present(nextRegions, nextTarget): void {
        presentedRegions = nextRegions;
        presentedTarget = nextTarget;
      },
    };

    backend.present(regions, target);

    expect(presentedRegions).toBe(regions);
    expect(presentedTarget).toBe(target);
  });
});

/** Reproduces the fixed pre-migration Canvas World-composition fixture. */
function composeLegacyWorldTile(world: World): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(world.tileSize * world.tileSize * 4);
  for (const layer of world.layers) {
    if (!layer.visible || layer.opacity === 0) {
      continue;
    }
    const tile = getRasterTileView(layer.raster, { x: 0, y: 0 });
    if (tile === undefined) {
      continue;
    }
    for (let offset = 0; offset < tile.pixels.length; offset += 4) {
      compositeRgbaSourceOverInPlace(
        tile.pixels,
        offset,
        pixels,
        offset,
        layer.opacity,
        layer.blendMode,
      );
    }
  }
  return pixels;
}
