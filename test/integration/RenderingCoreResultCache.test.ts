import { Raster, ReverieRangeError, World } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";
import { describe, expect, it } from "vitest";

describe("RenderingCore result cache", () => {
  it("keeps same-size World previews separate from canonical pixels and refines on settle", () => {
    const world = new World({ tileSize: 4 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    top.opacity = 0.7;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const isEven = (x + y) % 2 === 0;
        bottom.raster.setPixel(
          { x, y },
          isEven
            ? { r: 240, g: 10, b: 20, a: 255 }
            : { r: 10, g: 30, b: 220, a: 255 },
        );
        top.raster.setPixel(
          { x, y },
          isEven
            ? { r: 30, g: 230, b: 50, a: 160 }
            : { r: 220, g: 20, b: 180, a: 40 },
        );
      }
    }
    const core = new RenderingCore();
    const viewport = { x: 0, y: 0, width: 4, height: 4 };
    const source = { world };
    const preview = core.render({
      source,
      context: { scale: 1, quality: "interactive" },
      viewport,
    }).regions[0];
    expect(preview?.resultClass).toBe("approximate");
    expect(preview?.pixels).toHaveLength(16);
    expect(core.getDiagnosticsSnapshot().world).toMatchObject({
      approximateGeneratedCount: 1,
      approximateCompositionPixels: 8,
      canonicalGeneratedCount: 0,
    });
    expect(
      core.render({
        source,
        context: { scale: 1, quality: "interactive" },
        viewport,
      }).regions[0],
    ).toBe(preview);

    const canonical = core.render({
      source,
      context: { scale: 0.5, quality: "full" },
      viewport,
    }).regions[0];
    expect(canonical?.resultClass).toBeUndefined();
    expect(canonical?.pixels).not.toEqual(preview?.pixels);
    expect(core.getLastDiagnostics().generatedPixelBytes).toBe(16);
    expect(core.getDiagnosticsSnapshot().world).toMatchObject({
      approximateGeneratedCount: 1,
      canonicalGeneratedCount: 1,
      canonicalCompositionPixels: 32,
    });
    expect(
      core.render({
        source,
        context: { scale: 1, quality: "interactive" },
        viewport,
      }).regions[0],
    ).toBe(canonical);
    expect(core.getDiagnosticsSnapshot().world.canonicalCacheHits).toBe(1);
  });

  it.each([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "add",
  ] as const)(
    "renders deterministic translucent World previews with %s blend",
    (mode) => {
      const world = new World({ tileSize: 4 });
      const bottom = world.getLayer(0);
      const top = world.addLayer();
      top.blendMode = mode;
      top.opacity = 0.6;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          bottom.raster.setPixel(
            { x, y },
            { r: x * 40, g: y * 35, b: 120, a: 200 },
          );
          top.raster.setPixel(
            { x, y },
            { r: 180, g: x * 30, b: y * 40, a: (x + y) * 25 },
          );
        }
      }
      const core = new RenderingCore({ resultCacheByteBudget: 0 });
      const request = {
        source: { world },
        context: { scale: 1, quality: "interactive" as const },
        viewport: { x: 0, y: 0, width: 4, height: 4 },
      };
      const first = core.render(request).regions[0];
      const second = core.render(request).regions[0];
      expect(first?.resultClass).toBe("approximate");
      expect(first?.pixels).toHaveLength(16);
      expect(second?.pixels).toEqual(first?.pixels);
      expect(second).not.toBe(first);
    },
  );

  it("uses canonical World pixels for interaction at source Tile resolution", () => {
    const world = new World({ tileSize: 4 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 40, b: 10, a: 255 });
    const core = new RenderingCore();
    const request = {
      source: { world },
      viewport: { x: 0, y: 0, width: 4, height: 4 },
    };
    const preview = core.render({
      ...request,
      context: { scale: 2, quality: "interactive" },
    }).regions[0];
    const canonical = core.render({
      ...request,
      context: { scale: 1, quality: "full" },
    }).regions[0];
    expect(preview?.resultClass).toBeUndefined();
    expect(canonical).toBe(preview);
  });

  it("reuses one published Raster result across equivalent scales and preserves it after source mutation", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 255 });
    const core = new RenderingCore();
    const source = { raster };
    const viewport = { x: 0, y: 0, width: 2, height: 2 };
    const first = core.render({ source, context: { scale: 1 }, viewport })
      .regions[0];
    const second = core.render({ source, context: { scale: 0.99 }, viewport })
      .regions[0];
    expect(second).toBe(first);
    expect(core.getLastDiagnostics()).toMatchObject({
      generatedPixelBytes: 0,
      outputPixelBytes: 16,
    });
    raster.setPixel({ x: 0, y: 0 }, { r: 40, g: 50, b: 60, a: 255 });
    const changed = core.render({ source, context: {}, viewport }).regions[0];
    expect(changed).not.toBe(first);
    expect(Array.from(first?.pixels.slice(0, 4) ?? [])).toEqual([
      10, 20, 30, 255,
    ]);
    expect(Array.from(changed?.pixels.slice(0, 4) ?? [])).toEqual([
      40, 50, 60, 255,
    ]);
    expect(core.getDiagnosticsSnapshot().resultCache.validationFailures).toBe(
      1,
    );
  });

  it("retains independent LOD variants and evicts the least recently used result", () => {
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const core = new RenderingCore({ resultCacheByteBudget: 80 });
    const source = { raster };
    const viewport = { x: 0, y: 0, width: 4, height: 4 };
    const render = (scale: number) =>
      core.render({ source, context: { scale }, viewport }).regions[0];
    const full = render(1);
    const half = render(0.5);
    expect(render(1)).toBe(full);
    expect(core.getDiagnosticsSnapshot().resultCache).toMatchObject({
      entries: 2,
      bytes: 80,
    });
    render(0.25);
    expect(core.getDiagnosticsSnapshot().resultCache).toMatchObject({
      entries: 2,
      evictions: 1,
    });
    expect(render(1)).toBe(full);
    expect(render(0.5)).not.toBe(half);
  });

  it("keeps cache hits within the existing batch output budget", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 4, g: 5, b: 6, a: 255 });
    const core = new RenderingCore({ budget: { maxGeneratedPixelBytes: 16 } });
    const request = {
      source: { raster },
      context: {},
      viewport: { x: 0, y: 0, width: 4, height: 2 },
    };
    let batch = core.render(request);
    expect(batch.regions).toHaveLength(1);
    if (batch.continuation === undefined)
      throw new Error("Expected continuation");
    core.continueRender(batch.continuation);
    batch = core.render(request);
    expect(batch.regions).toHaveLength(1);
    expect(batch.continuation).toBeDefined();
    expect(core.getLastDiagnostics()).toMatchObject({
      generatedPixelBytes: 0,
      outputPixelBytes: 16,
    });
  });

  it("does not reuse a replaced Tile or confuse an absent Tile with its replacement", () => {
    const raster = new Raster({ tileSize: 2 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context: {},
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };
    expect(core.render(request).regions).toEqual([]);
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 0, b: 0, a: 255 });
    const first = core.render(request).regions[0];
    raster.clearRegion({ x: 0, y: 0, width: 2, height: 2 });
    expect(core.render(request).regions).toEqual([]);
    raster.setPixel({ x: 0, y: 0 }, { r: 20, g: 0, b: 0, a: 255 });
    const replacement = core.render(request).regions[0];
    expect(replacement).not.toBe(first);
    expect(replacement?.pixels[0]).toBe(20);
  });

  it("does not share results between distinct source instances", () => {
    const first = new Raster({ tileSize: 2 });
    const second = new Raster({ tileSize: 2 });
    first.setPixel({ x: 0, y: 0 }, { r: 10, g: 0, b: 0, a: 255 });
    second.setPixel({ x: 0, y: 0 }, { r: 20, g: 0, b: 0, a: 255 });
    const core = new RenderingCore();
    const viewport = { x: 0, y: 0, width: 2, height: 2 };
    const firstRegion = core.render({
      source: { raster: first },
      context: {},
      viewport,
    }).regions[0];
    const secondRegion = core.render({
      source: { raster: second },
      context: {},
      viewport,
    }).regions[0];
    expect(secondRegion).not.toBe(firstRegion);
    expect(secondRegion?.pixels[0]).toBe(20);
  });

  it("composes full World pixels independently of viewport while preserving alpha omission", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    top.raster.setPixel({ x: 1, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const core = new RenderingCore();
    const source = { world };
    const first = core.render({
      source,
      context: {},
      viewport: { x: 0, y: 0, width: 1, height: 1 },
    }).regions[0];
    const second = core.render({
      source,
      context: {},
      viewport: { x: 1, y: 0, width: 1, height: 1 },
    }).regions[0];
    const uncached = new RenderingCore({ resultCacheByteBudget: 0 }).render({
      source,
      context: {},
      viewport: { x: 1, y: 0, width: 1, height: 1 },
    }).regions[0];
    expect(second).toBe(first);
    expect(uncached?.pixels).toEqual(first?.pixels);
    expect(Array.from(first?.pixels.slice(0, 8) ?? [])).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(
      core.render({
        source,
        context: {},
        viewport: { x: 0, y: 1, width: 2, height: 1 },
      }).regions,
    ).toEqual([]);
  });

  it("invalidates World results after composition state or source Tile changes", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 100, g: 0, b: 0, a: 255 });
    top.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 100, b: 0, a: 255 });
    const core = new RenderingCore();
    const request = {
      source: { world },
      context: {},
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };
    const first = core.render(request).regions[0];
    expect(core.render(request).regions[0]).toBe(first);
    top.opacity = 0.5;
    const opacityChanged = core.render(request).regions[0];
    expect(opacityChanged).not.toBe(first);
    top.blendMode = "multiply";
    expect(core.render(request).regions[0]).not.toBe(opacityChanged);
    top.visible = false;
    const hidden = core.render(request).regions[0];
    expect(hidden).not.toBe(opacityChanged);
    top.visible = true;
    world.moveLayer(top, 0);
    const reordered = core.render(request).regions[0];
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    expect(core.render(request).regions[0]).not.toBe(reordered);
    const added = world.addLayer();
    added.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    const withAddedLayer = core.render(request).regions[0];
    world.removeLayer(added);
    expect(core.render(request).regions[0]).not.toBe(withAddedLayer);
  });

  it("does not cache stale layer state when a World changes between continuation batches", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    for (const x of [0, 2]) {
      bottom.raster.setPixel({ x, y: 0 }, { r: 100, g: 0, b: 0, a: 255 });
      top.raster.setPixel({ x, y: 0 }, { r: 0, g: 100, b: 0, a: 255 });
    }
    const core = new RenderingCore({ budget: { maxGeneratedPixelBytes: 16 } });
    const request = {
      source: { world },
      context: {},
      viewport: { x: 0, y: 0, width: 4, height: 2 },
    };
    const first = core.render(request);
    if (first.continuation === undefined)
      throw new Error("Expected continuation");
    top.visible = false;
    const continued = core.continueRender(first.continuation);
    const secondRegion = continued.regions[0];
    expect(secondRegion?.pixels.slice(0, 4)).toEqual(
      new Uint8Array([100, 0, 0, 255]),
    );
    const fresh = core.render(request);
    if (fresh.continuation === undefined)
      throw new Error("Expected continuation");
    const freshSecondRegion = core.continueRender(fresh.continuation)
      .regions[0];
    expect(freshSecondRegion).toBe(secondRegion);
  });

  it("does not retain oversized results and releases buffers on dispose", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const request = {
      source: { raster },
      context: {},
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };
    const small = new RenderingCore({ resultCacheByteBudget: 4 });
    expect(small.render(request).regions).toHaveLength(1);
    expect(small.getDiagnosticsSnapshot().resultCache.entries).toBe(0);
    const disabled = new RenderingCore({ resultCacheByteBudget: 0 });
    disabled.render(request);
    expect(disabled.getDiagnosticsSnapshot().resultCache.entries).toBe(0);
    const core = new RenderingCore();
    core.render(request);
    expect(core.getDiagnosticsSnapshot().resultCache.bytes).toBe(16);
    core.dispose();
    expect(core.getDiagnosticsSnapshot().resultCache).toMatchObject({
      entries: 0,
      bytes: 0,
    });
  });

  it.each([-1, 1.5, Number.NaN])(
    "rejects an invalid cache byte budget %s",
    (budget) => {
      expect(
        () => new RenderingCore({ resultCacheByteBudget: budget }),
      ).toThrow(ReverieRangeError);
    },
  );
});
