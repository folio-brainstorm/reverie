import { describe, expect, it } from "vitest";

import { Raster, World } from "@reverie/core";
import { getRasterTileVersion } from "@reverie/core/rendering/internal";

import { ExportRenderer, ExporterErrorDefinitions } from "../index.js";

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const REGION = { x: 0, y: 0, width: 1, height: 1 };

describe("World export composition", () => {
  it("keeps its source fixed while the caller changes the original config", () => {
    const world = new World({ tileSize: 2 });
    world.getLayer(0).raster.setPixel({ x: 0, y: 0 }, RED);
    const config = { world };
    const renderer = new ExportRenderer(config);
    config.world = new World();
    expect(renderer.world).toBe(world);
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(Object.isFrozen(config)).toBe(false);
  });

  it("rejects missing or conflicting sources instead of silently falling back", () => {
    // @ts-expect-error JavaScript callers must also choose exactly one source.
    expect(() => new ExportRenderer({})).toThrow("EC_EXPORTER_0018");
    expect(() => {
      // @ts-expect-error Supplying both sources is intentionally invalid.
      return new ExportRenderer({ raster: new Raster(), world: new World() });
    }).toThrow("EC_EXPORTER_0018");
  });
  it("uses top opaque color and follows order changes without source mutation", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, RED);
    top.raster.setPixel({ x: 0, y: 0 }, BLUE);
    const version = getRasterTileVersion(top.raster, { x: 0, y: 0 });
    const renderer = new ExportRenderer({ world });
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([
      0, 0, 255, 255,
    ]);
    world.moveLayer(top, 0);
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(top.raster.getPixel({ x: 0, y: 0 })).toEqual(BLUE);
    expect(getRasterTileVersion(top.raster, { x: 0, y: 0 })).toEqual(version);
  });

  it.each([
    { opacity: 0, expected: [255, 0, 0, 255] },
    { opacity: 0.25, expected: [191, 0, 64, 255] },
    { opacity: 0.5, expected: [128, 0, 128, 255] },
    { opacity: 1, expected: [0, 0, 255, 255] },
  ])(
    "composes opacity $opacity without changing stored alpha",
    ({ opacity, expected }) => {
      const world = new World({ tileSize: 2 });
      world.getLayer(0).raster.setPixel({ x: 0, y: 0 }, RED);
      const top = world.addLayer();
      top.raster.setPixel({ x: 0, y: 0 }, BLUE);
      top.opacity = opacity;
      const renderer = new ExportRenderer({ world });
      expect(Array.from(renderer.render(REGION).pixels)).toEqual(expected);
      expect(top.raster.getPixel({ x: 0, y: 0 })).toEqual(BLUE);
      top.opacity = 1;
      expect(Array.from(renderer.render(REGION).pixels)).toEqual([
        0, 0, 255, 255,
      ]);
    },
  );

  it("applies a layer blend mode before layer opacity", () => {
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 100, g: 100, b: 100, a: 255 });
    const top = world.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 150, b: 50, a: 255 });
    top.blendMode = "multiply";
    expect(
      Array.from(new ExportRenderer({ world }).render(REGION).pixels),
    ).toEqual([78, 59, 20, 255]);
  });

  it("multiplies pixel alpha by layer opacity with straight RGB", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { ...RED, a: 128 });
    top.raster.setPixel({ x: 0, y: 0 }, { ...BLUE, a: 128 });
    top.opacity = 0.5;
    expect(
      Array.from(new ExportRenderer({ world }).render(REGION).pixels),
    ).toEqual([153, 0, 102, 160]);
    bottom.visible = false;
    expect(
      Array.from(new ExportRenderer({ world }).render(REGION).pixels),
    ).toEqual([0, 0, 255, 64]);
  });

  it("skips hidden layers and restores contents when made visible", () => {
    const world = new World({ tileSize: 2 });
    const layer = world.getLayer(0);
    layer.raster.setPixel({ x: 0, y: 0 }, BLUE);
    const renderer = new ExportRenderer({ world });
    layer.visible = false;
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([0, 0, 0, 0]);
    layer.visible = true;
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("treats empty layers, missing tiles, and transparent pixels as transparent", () => {
    const world = new World({ tileSize: 2 });
    world.addLayer();
    world.getLayer(0).raster.setPixel({ x: 0, y: 0 }, { ...RED, a: 0 });
    const result = new ExportRenderer({ world }).render({
      x: -3,
      y: -3,
      width: 8,
      height: 8,
    });
    expect(result.pixels.every((value) => value === 0)).toBe(true);
  });

  it.each([
    { x: -3, y: -2 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ])(
    "shares coordinates across layers at $x,$y and crosses tile boundaries",
    (pixel) => {
      const world = new World({ tileSize: 2 });
      world.getLayer(0).raster.setPixel(pixel, RED);
      world.addLayer().raster.setPixel(pixel, BLUE);
      const region = { x: pixel.x - 1, y: pixel.y - 1, width: 3, height: 3 };
      const result = new ExportRenderer({ world }).render(region);
      expect(Array.from(result.pixels.slice(16, 20))).toEqual([0, 0, 255, 255]);
      expect(Array.from(result.pixels.slice(0, 4))).toEqual([0, 0, 0, 0]);
    },
  );

  it("clips composed World pixels to bounds while standalone Raster stays unbounded", () => {
    const world = new World({
      tileSize: 2,
      bounds: { x: -1, y: -1, width: 2, height: 2 },
    });
    const raster = world.getLayer(0).raster;
    raster.setPixel({ x: -1, y: -1 }, RED);
    raster.setPixel({ x: 1, y: -1 }, BLUE);
    const region = { x: -1, y: -1, width: 3, height: 1 };
    expect(
      Array.from(new ExportRenderer({ world }).render(region).pixels),
    ).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(
      Array.from(new ExportRenderer({ raster }).render(region).pixels).slice(8),
    ).toEqual([0, 0, 255, 255]);
    expect(
      new ExportRenderer({ world }).render({
        x: 100,
        y: 100,
        width: 1,
        height: 1,
      }).pixels,
    ).toEqual(new Uint8ClampedArray(4));
  });

  it("retains independent Raster byte-copy semantics, including transparent RGB", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { ...RED, a: 0 });
    const renderer = new ExportRenderer({ raster });
    expect(renderer.raster.tileSize).toBe(2);
    expect(Array.from(renderer.render(REGION).pixels)).toEqual([255, 0, 0, 0]);
  });

  it.each([
    {
      region: { ...REGION, width: 0 },
      code: ExporterErrorDefinitions.INVALID_REGION_SIZE.code,
    },
    {
      region: { ...REGION, height: -1 },
      code: ExporterErrorDefinitions.INVALID_REGION_SIZE.code,
    },
    {
      region: { ...REGION, x: Number.NaN },
      code: ExporterErrorDefinitions.INVALID_REGION_COORDINATE.code,
    },
    {
      region: { ...REGION, y: Number.POSITIVE_INFINITY },
      code: ExporterErrorDefinitions.INVALID_REGION_COORDINATE.code,
    },
  ])("keeps export region validation for $code", ({ region, code }) => {
    expect(() =>
      new ExportRenderer({ world: new World() }).render(region),
    ).toThrow(code);
  });
});
