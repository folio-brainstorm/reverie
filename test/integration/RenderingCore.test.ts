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
import { describe, expect, it, vi } from "vitest";

const context: RenderContext = {};

describe("RenderingCore", () => {
  it("uses the existing coarser LOD for interaction and restores full output", () => {
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const core = new RenderingCore();
    const viewport = { x: 0, y: 0, width: 4, height: 4 };
    const source = { raster };

    const full = core.render({
      source,
      context: { scale: 1, quality: "full" },
      viewport,
    });
    const interactive = core.render({
      source,
      context: { scale: 1, quality: "interactive" },
      viewport,
    });
    const settled = core.render({
      source,
      context: { scale: 1, quality: "full" },
      viewport,
    });

    expect(full.regions[0]?.pixels).toHaveLength(4 * 4 * 4);
    expect(interactive.regions[0]?.pixels).toHaveLength(2 * 2 * 4);
    expect(settled.regions).toEqual(full.regions);
  });

  it("skips excluded tiles before spending candidate budget and skips retained tiles", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const core = new RenderingCore({ budget: { maxCandidateTiles: 1 } });
    const first = core.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 4, height: 2 },
      excludeViewport: { x: 0, y: 0, width: 2, height: 2 },
    });

    expect(first.regions.map((region) => region.bounds.x)).toEqual([2]);

    const reused = core.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 4, height: 2 },
      skipTiles: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    expect(reused.regions).toEqual([]);
  });

  it("uses effective output Tile size as the generation compatibility identity", () => {
    const core = new RenderingCore();
    expect(core.resolveOutputTileSize(128, { scale: 1, quality: "full" })).toBe(
      128,
    );
    expect(
      core.resolveOutputTileSize(128, { scale: 0.99, quality: "full" }),
    ).toBe(128);
    expect(
      core.resolveOutputTileSize(128, { scale: 0.5, quality: "full" }),
    ).toBe(64);
    expect(
      core.resolveOutputTileSize(128, { scale: 1, quality: "interactive" }),
    ).toBe(64);
  });

  it.each([0, -1, Number.NaN, 1.5])(
    "rejects invalid source Tile size %s at the output requirement boundary",
    (tileSize) => {
      expect(() =>
        new RenderingCore().resolveOutputTileSize(tileSize, {}),
      ).toThrow(ReverieRangeError);
    },
  );

  it("reaches a newly visible Tile despite earlier offscreen allocations", () => {
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    }
    const core = new RenderingCore({
      budget: {
        maxCandidateTiles: 1,
        maxGeneratedPixelBytes: 1024,
        maxRenderDurationMs: 1_000,
      },
    });
    const result = core.render({
      source: { raster },
      context,
      viewport: { x: 258, y: 0, width: 2, height: 2 },
    });
    expect(result.regions.map((region) => region.bounds.x)).toEqual([258]);
  });

  it("accepts negative Tile coordinates and rejects invalid reuse and exclusion inputs", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: -2, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context,
      viewport: { x: -2, y: 0, width: 2, height: 2 },
    };

    expect(
      core.render({ ...request, skipTiles: [{ x: -1, y: 0 }] }).regions,
    ).toEqual([]);
    expect(() =>
      core.render({
        ...request,
        skipTiles: [{ x: Number.NaN, y: 0 }],
      }),
    ).toThrow(ReverieRangeError);
    expect(() =>
      core.render({
        ...request,
        excludeViewport: { x: 0, y: 0, width: -1, height: 2 },
      }),
    ).toThrow(ReverieRangeError);
    expect(() =>
      core.render({
        ...request,
        context: {
          // @ts-expect-error Runtime validation protects JavaScript callers.
          quality: "preview",
        },
      }),
    ).toThrow(ReverieTypeError);
  });

  it("omits missing, byte-zero, and hidden-RGB Raster tiles without changing source bytes", () => {
    const raster = new Raster({ tileSize: 2 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };

    expect(core.render(request).regions).toEqual([]);
    raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    expect(core.render(request).regions).toEqual([]);
    raster.setPixel({ x: 1, y: 1 }, { r: 255, g: 20, b: 30, a: 0 });
    expect(core.render(request).regions).toEqual([]);
    expect(
      Array.from(getRasterTileView(raster, { x: 0, y: 0 })?.pixels ?? []).slice(
        12,
      ),
    ).toEqual([255, 20, 30, 0]);

    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 1 });
    expect(core.render(request).regions).toHaveLength(1);
  });

  it("uses the smallest alpha bounds when testing viewport contribution", () => {
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 0 });
    raster.setPixel({ x: 1, y: 1 }, { r: 0, g: 255, b: 0, a: 1 });
    raster.setPixel({ x: 2, y: 2 }, { r: 0, g: 0, b: 255, a: 1 });
    const core = new RenderingCore();
    const render = (viewport: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => core.render({ source: { raster }, context, viewport }).regions;

    expect(render({ x: 0, y: 0, width: 1, height: 4 })).toEqual([]);
    expect(render({ x: 0, y: 0, width: 4, height: 1 })).toEqual([]);
    expect(render({ x: 1, y: 1, width: 1, height: 1 })).toHaveLength(1);
    expect(render({ x: 2, y: 2, width: 1, height: 1 })).toHaveLength(1);
    expect(render({ x: 3, y: 3, width: 1, height: 1 })).toEqual([]);
    expect(render({ x: 1, y: 1, width: 1, height: 1 })[0]?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
  });

  it("reuses an unchanged Tile summary and recomputes it after revision changes", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 0 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };
    expect(core.render(request).regions).toEqual([]);

    // Bypass the read-only live-view contract only to prove unchanged revisions reuse coverage.
    const view = getRasterTileView(raster, { x: 0, y: 0 });
    if (view === undefined) {
      throw new Error("Expected an allocated Tile view.");
    }
    view.pixels[3] = 255;
    expect(core.render(request).regions).toEqual([]);
    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 255 });
    expect(core.render(request).regions).toHaveLength(1);

    raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 0 });
    expect(core.render(request).regions).toEqual([]);
  });

  it("avoids World composite allocation when layers have no visible contributor", () => {
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 0 });
    const hidden = world.addLayer();
    hidden.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    hidden.visible = false;
    const transparent = world.addLayer();
    transparent.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    transparent.opacity = 0;
    const core = new RenderingCore();
    const allocation = vi.spyOn(globalThis, "Uint8ClampedArray");
    try {
      const result = core.render({
        source: { world },
        context,
        viewport: { x: 0, y: 0, width: 2, height: 2 },
      });
      expect(result.regions).toEqual([]);
      expect(core.getLastDiagnostics().generatedPixelBytes).toBe(0);
      expect(allocation).not.toHaveBeenCalled();
    } finally {
      allocation.mockRestore();
    }
  });

  it("composes a visible World contributor after rejecting render-empty layers", () => {
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 0 });
    const top = world.addLayer();
    top.raster.setPixel({ x: 1, y: 1 }, { r: 12, g: 34, b: 56, a: 255 });
    const result = new RenderingCore().render({
      source: { world },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    });
    expect(result.regions).toHaveLength(1);
    expect(Array.from(result.regions[0]?.pixels ?? [])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 34, 56, 255,
    ]);
  });

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

  it("traverses allocated sparse Tiles instead of the viewport Tile grid", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    raster.setPixel(
      { x: 2_000_000, y: 2_000_000 },
      { r: 4, g: 5, b: 6, a: 255 },
    );
    const renderingCore = new RenderingCore({
      budget: {
        maxCandidateTiles: 8,
        maxGeneratedPixelBytes: 1024,
        maxRenderDurationMs: 1_000,
      },
    });

    const result = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2_000_002, height: 2_000_002 },
    });

    expect(result.regions).toHaveLength(2);
    expect(renderingCore.getLastDiagnostics()).toMatchObject({
      candidateTileCount: 2,
      renderedTileCount: 2,
      generatedPixelBytes: 32,
      processedRegionCount: 2,
    });
  });

  it("publishes grouped counters without optional timing and detaches each snapshot", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };

    core.render(request);
    const first = core.getDiagnosticsSnapshot();
    expect(first.rendering).toBeUndefined();
    expect(first.tiles).toEqual({
      candidateCount: 1,
      visibleCount: 1,
      renderedCount: 1,
      renderEmptyCount: 0,
      generatedPixelBytes: 16,
    });
    expect(first.regions.generatedCount).toBe(1);
    expect(first.quality).toEqual({
      outputTileSize: 2,
      effectiveRenderScale: 1,
    });
    expect(first.progressive).toMatchObject({
      requestCount: 1,
      completedRequestCount: 1,
      cancelledRequestCount: 0,
      continuationCount: 0,
      batchCount: 1,
      hasPendingRequest: false,
    });
    expect(Object.isFrozen(first.tiles)).toBe(true);
    core.render(request);
    expect(first.progressive.requestCount).toBe(1);
    expect(core.getDiagnosticsSnapshot().progressive.requestCount).toBe(2);
  });

  it("counts cancelled and continued requests while recording opted-in stage timing", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const core = new RenderingCore({
      budget: { maxCandidateTiles: 1, maxRenderDurationMs: 1_000 },
      diagnostics: { timings: true },
    });
    const request = {
      source: { raster },
      context: { scale: 0.5 },
      viewport: { x: 0, y: 0, width: 4, height: 2 },
    };
    const first = core.render(request);
    expect(first.continuation).toBeDefined();
    expect(core.getDiagnosticsSnapshot().progressive.hasPendingRequest).toBe(
      true,
    );
    if (first.continuation === undefined) {
      throw new Error("Expected a continuation.");
    }
    let next = core.continueRender(first.continuation);
    while (next.continuation !== undefined) {
      next = core.continueRender(next.continuation);
    }
    const completed = core.getDiagnosticsSnapshot();
    expect(completed.progressive).toMatchObject({
      requestCount: 1,
      completedRequestCount: 1,
      hasPendingRequest: false,
    });
    expect(completed.progressive.continuationCount).toBeGreaterThanOrEqual(1);
    expect(completed.progressive.batchCount).toBeGreaterThanOrEqual(2);
    expect(completed.rendering?.coreDurationMs.current).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      completed.rendering?.rasterDurationMs.current,
    ).toBeGreaterThanOrEqual(0);
    expect(completed.rendering?.lodDurationMs.current).toBeGreaterThanOrEqual(
      0,
    );
    expect(Object.isFrozen(completed.rendering?.coreDurationMs)).toBe(true);
    core.render(request);
    core.render(request);
    expect(
      core.getDiagnosticsSnapshot().progressive.cancelledRequestCount,
    ).toBe(1);
  });

  it("collects timing only while enabled and starts a fresh window when reenabled", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const core = new RenderingCore();
    const request = {
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
    };

    core.render(request);
    expect(core.getDiagnosticsSnapshot().rendering).toBeUndefined();

    core.setTimingDiagnosticsEnabled(true);
    expect(core.getDiagnosticsSnapshot().rendering).toBeUndefined();
    core.render(request);
    expect(
      core.getDiagnosticsSnapshot().rendering?.coreDurationMs.current,
    ).toBeGreaterThanOrEqual(0);

    core.setTimingDiagnosticsEnabled(false);
    expect(core.getDiagnosticsSnapshot().rendering).toBeUndefined();
    core.render(request);
    expect(core.getDiagnosticsSnapshot().rendering).toBeUndefined();

    core.setTimingDiagnosticsEnabled(true);
    expect(core.getDiagnosticsSnapshot().rendering).toBeUndefined();
    expect(core.getDiagnosticsSnapshot().progressive.requestCount).toBe(3);
    core.render(request);
    expect(
      core.getDiagnosticsSnapshot().rendering?.coreDurationMs.current,
    ).toBeGreaterThanOrEqual(0);
    expect(core.getDiagnosticsSnapshot().progressive.requestCount).toBe(4);
  });

  it("rejects a non-boolean timing setting from a JavaScript caller", () => {
    const core = new RenderingCore();

    expect(() =>
      // @ts-expect-error Runtime validation protects JavaScript callers.
      core.setTimingDiagnosticsEnabled("on"),
    ).toThrow("EC_RENDERING_0008");
  });

  it("clears pending diagnostics when a caller discards a continuation", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const core = new RenderingCore({
      budget: { maxCandidateTiles: 1, maxRenderDurationMs: 1_000 },
    });
    const result = core.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 4, height: 2 },
    });
    if (result.continuation === undefined) {
      throw new Error("Expected a continuation.");
    }

    core.cancelPendingRender();
    expect(core.getDiagnosticsSnapshot().progressive).toMatchObject({
      cancelledRequestCount: 1,
      hasPendingRequest: false,
    });
    expect(core.continueRender(result.continuation).regions).toEqual([]);
    expect(core.getDiagnosticsSnapshot().progressive.continuationCount).toBe(0);
  });

  it("keeps the requested Tile resolution across pixel-budget batches", () => {
    const raster = new Raster({ tileSize: 8 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 8, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderingCore = new RenderingCore({
      budget: {
        maxCandidateTiles: 2,
        maxGeneratedPixelBytes: 256,
        maxRenderDurationMs: 1_000,
      },
    });

    const result = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 16, height: 8 },
    });

    expect(result.continuation).toBeDefined();
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.pixels).toHaveLength(256);
    expect(renderingCore.getLastDiagnostics().generatedPixelBytes).toBe(256);
    const continuation = result.continuation;
    if (continuation === undefined) {
      throw new Error("Expected another full-resolution Tile batch.");
    }
    const next = renderingCore.continueRender(continuation);
    expect(next.regions).toHaveLength(1);
    expect(next.regions[0]?.pixels).toHaveLength(256);
    expect(next.continuation).toBeUndefined();
  });

  it("returns all visible content through pull-based continuation batches", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 4, y: 0 }, { r: 3, g: 0, b: 0, a: 255 });
    const renderingCore = new RenderingCore({
      budget: {
        maxCandidateTiles: 2,
        maxGeneratedPixelBytes: 4,
        maxRenderDurationMs: 1_000,
      },
    });
    let result = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 6, height: 2 },
    });
    const regions = [...result.regions];

    while (result.continuation !== undefined) {
      result = renderingCore.continueRender(result.continuation);
      regions.push(...result.regions);
    }

    expect([...new Set(regions.map((region) => region.bounds.x))]).toEqual([
      0, 2, 4,
    ]);
  });

  it("cancels an older continuation when a newer viewport request begins", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const renderingCore = new RenderingCore({
      budget: {
        maxCandidateTiles: 2,
        maxGeneratedPixelBytes: 4,
        maxRenderDurationMs: 1_000,
      },
    });
    const oldResult = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 4, height: 2 },
    });
    const continuation = oldResult.continuation;
    if (continuation === undefined) {
      throw new Error(
        "Expected the first request to exceed its candidate budget.",
      );
    }

    const latestResult = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 2, y: 0, width: 2, height: 2 },
    });

    expect(latestResult.regions.map((region) => region.bounds.x)).toEqual([2]);
    expect(renderingCore.continueRender(continuation)).toMatchObject({
      identity: oldResult.identity,
      regions: [],
    });
  });

  it("resolves hinted late Tiles before unrelated allocated candidates", () => {
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 8; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: x, g: 0, b: 0, a: 255 });
    }
    const renderingCore = new RenderingCore({
      budget: {
        maxCandidateTiles: 1,
        maxGeneratedPixelBytes: 1024,
        maxRenderDurationMs: 1_000,
      },
    });

    const first = renderingCore.render({
      source: { raster },
      context,
      viewport: { x: 0, y: 0, width: 8, height: 2 },
      interactiveTiles: [{ x: 3, y: 0 }],
    });

    expect(first.regions[0]?.bounds.x).toBe(6);
    expect(first.continuation).toBeDefined();
    const bounds = [...first.regions.map((region) => region.bounds.x)];
    let next = first;
    while (next.continuation !== undefined) {
      next = renderingCore.continueRender(next.continuation);
      bounds.push(...next.regions.map((region) => region.bounds.x));
    }
    expect(bounds).toEqual([6, 0, 2, 4]);
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 2 },
    { x: 0, y: 0, width: 2, height: 0 },
  ])("returns no regions for a zero-area viewport", (viewport) => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });

    expect(
      new RenderingCore().render({ source: { raster }, context, viewport }),
    ).toMatchObject({ regions: [] });
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
    const regions: RenderRegionSet = {
      identity: {
        requestId: 1,
        viewportKey: "test",
        sourceRevision: "test",
      },
      regions: [],
    };
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
