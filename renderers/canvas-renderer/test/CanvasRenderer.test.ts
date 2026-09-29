import { describe, expect, it, vi } from "vitest";

import { Camera, Raster, World } from "@reveriejs/core";
import {
  deserializeDocument,
  serializeDocument,
} from "@reveriejs/core/document";
import { RenderingCore } from "@reveriejs/core/rendering";
import type { Renderer } from "@reveriejs/core/rendering";

import {
  CanvasRenderer,
  RendererErrorDefinitions,
  RendererError,
  RendererTypeError,
  RendererRangeError,
} from "../index.js";
import type { CanvasRendererConfig } from "../index.js";
import CanvasBackend from "../src/canvas/CanvasBackend.js";
import CanvasDiagnostics from "../src/canvas/CanvasDiagnostics.js";

function createRenderingContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
      height,
      width,
    })),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createCanvasFixture(width = 4, height = 4) {
  const context = createRenderingContext();
  const tileCanvases: HTMLCanvasElement[] = [];
  const tileContexts: CanvasRenderingContext2D[] = [];
  const ownerDocument = {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== "canvas") {
        throw new Error(`Unexpected element request: ${tagName}`);
      }

      const tileContext = createRenderingContext();
      const tileCanvas = {
        getContext: vi.fn(() => tileContext),
        height: 0,
        width: 0,
      } as unknown as HTMLCanvasElement;

      tileCanvases.push(tileCanvas);
      tileContexts.push(tileContext);
      return tileCanvas;
    }),
  };
  const canvas = {
    getContext: vi.fn(() => context),
    height,
    ownerDocument: ownerDocument as unknown as Document,
    width,
  } as unknown as HTMLCanvasElement;

  return { canvas, context, ownerDocument, tileCanvases, tileContexts };
}

describe("CanvasRenderer World composition", () => {
  it.each(["world", "raster"] as const)(
    "makes progress beyond the batch limit during continuous %s Pan after a full render",
    (sourceKind) => {
      const clock = vi.spyOn(performance, "now").mockReturnValue(0);
      const { canvas, context } = createCanvasFixture(600, 8);
      const world = new World({ tileSize: 8 });
      for (let x = 0; x < 129 * 8; x += 8) {
        world
          .getLayer(0)
          .raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
      }
      const camera = new Camera({ panX: -8, panY: -8, zoom: 0.25 });
      const renderer = new CanvasRenderer({
        canvas,
        camera,
        ...(sourceKind === "world"
          ? { world }
          : { raster: world.getLayer(0).raster }),
      });
      try {
        renderer.render();
        for (
          let batch = 0;
          renderer.hasPendingRender && batch < 4;
          batch += 1
        ) {
          renderer.render();
        }
        expect(renderer.hasPendingRender).toBe(false);
        for (let frame = 0; frame < 2; frame += 1) {
          camera.panBy(0.25, 0);
          renderer.render({ quality: "interactive" });
        }
        expect(renderer.hasPendingRender).toBe(false);
        expect(
          renderer.diagnostics.getSnapshot().world.approximateGeneratedCount,
        ).toBe(sourceKind === "world" ? 129 : 0);
        expect(
          renderer.diagnostics.getSnapshot().progressive.cancelledRequestCount,
        ).toBe(1);
        vi.mocked(context.drawImage).mockClear();

        camera.panBy(0.25, 0);
        renderer.render({ quality: "interactive" });

        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        expect(
          renderer.diagnostics.getSnapshot().tiles.generatedPixelBytes,
        ).toBe(0);
        expect(context.drawImage).toHaveBeenCalledTimes(129);
        expect(
          renderer.diagnostics.getSnapshot().presentation.uploadedRegionCount,
        ).toBe(0);

        vi.mocked(context.drawImage).mockClear();
        camera.panBy(-0.25, 0);
        renderer.render({ quality: "interactive" });
        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        expect(context.drawImage).toHaveBeenCalledTimes(129);

        renderer.render({ quality: "full" });
        expect(renderer.hasPendingRender).toBe(false);
        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        expect(
          renderer.diagnostics.getSnapshot().presentation.uploadedRegionCount,
        ).toBe(0);
        vi.mocked(context.drawImage).mockClear();
        camera.panBy(0.25, 0);
        renderer.render({ quality: "interactive" });
        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        expect(context.drawImage).toHaveBeenCalledTimes(129);
      } finally {
        renderer.dispose();
        clock.mockRestore();
      }
    },
  );

  it("uses published pixel identity before falling back to byte comparison", () => {
    const { canvas, tileContexts } = createCanvasFixture(1, 1);
    const diagnostics = new CanvasDiagnostics(new RenderingCore(), false);
    const backend = new CanvasBackend(canvas, new Camera(), null, diagnostics);
    const bounds = { x: 0, y: 0, width: 1, height: 1 };
    const first = new Uint8Array([255, 0, 0, 255]);

    backend.presentRegions([{ bounds, pixels: first }]);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledOnce();
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(1);

    backend.presentRegions([{ bounds, pixels: first }]);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledOnce();
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(1);
    expect(diagnostics.getSnapshot().presentation.rgbaIdentityReuseCount).toBe(
      1,
    );

    const equivalent = new Uint8Array(first);
    backend.presentRegions([{ bounds, pixels: equivalent }]);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledOnce();
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(2);

    backend.presentRegions([{ bounds, pixels: equivalent }]);
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(2);

    backend.presentRegions([
      { bounds, pixels: new Uint8Array([0, 255, 0, 255]) },
    ]);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(2);
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(3);

    backend.retainNear({ x: 100, y: 100, width: 1, height: 1 }, 0);
    backend.presentRegions([{ bounds, pixels: first }]);
    expect(tileContexts).toHaveLength(2);
    expect(tileContexts[1]?.putImageData).toHaveBeenCalledOnce();
    expect(diagnostics.getSnapshot().presentation.rgbaComparisonCount).toBe(4);
  });

  it("does no Canvas drawing or RGBA comparison for an equivalent settled render", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();
    vi.mocked(context.drawImage).mockClear();
    vi.mocked(context.clearRect).mockClear();
    vi.mocked(tileContexts[0]?.putImageData).mockClear();

    renderer.render();

    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(tileContexts[0]?.putImageData).not.toHaveBeenCalled();
    expect(
      renderer.diagnostics.getSnapshot().presentation.rgbaComparisonCount,
    ).toBe(0);
  });

  it("does not replay a projected Region after the required full presentation", () => {
    const { canvas, context } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });
    renderer.render();
    vi.mocked(context.drawImage).mockClear();

    camera.setPan(1, 0);
    renderer.render();

    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(
      renderer.diagnostics.getSnapshot().presentation.rgbaComparisonCount,
    ).toBe(0);
  });

  it("defers and resumes an existing warm continuation without cancelling prefetch", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let y = 0; y < 25; y += 1) {
      for (let x = 0; x < 25; x += 1) {
        raster.setPixel({ x: x * 2, y: y * 2 }, { r: 255, g: 0, b: 0, a: 255 });
      }
    }
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render({ prefetch: true });
    renderer.render({ prefetch: true, remainingFrameBudgetMs: 4 });
    expect(renderer.hasPendingRender).toBe(true);

    renderer.render({ prefetch: true, remainingFrameBudgetMs: 0 });
    expect(
      renderer.diagnostics.getSnapshot().coverage.warmContinuationDeferredCount,
    ).toBe(1);
    expect(renderer.hasPendingRender).toBe(true);

    renderer.render({ prefetch: true, remainingFrameBudgetMs: 4 });
    expect(
      renderer.diagnostics.getSnapshot().coverage.warmContinuationExecutedCount,
    ).toBe(1);
    expect(
      renderer.diagnostics.getSnapshot().coverage.prefetchCompletedCount,
    ).toBeGreaterThan(0);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid remaining frame budget hint %s",
    (remainingFrameBudgetMs) => {
      const { canvas } = createCanvasFixture(2, 2);
      const renderer = new CanvasRenderer({
        canvas,
        raster: new Raster({ tileSize: 2 }),
        camera: new Camera(),
      });
      expect(() => renderer.render({ remainingFrameBudgetMs })).toThrow(
        `[${RendererErrorDefinitions.INVALID_FRAME_BUDGET_HINT.code}]`,
      );
    },
  );
  it("reuses the same output resolution across small zoom changes and repeat renders", () => {
    const { canvas } = createCanvasFixture(128, 128);
    const raster = new Raster({ tileSize: 128 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.render();
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);

    camera.setZoom(0.99);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(
      128,
    );

    camera.setZoom(0.5);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(1);
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(64);
    expect(
      renderer.diagnostics.getSnapshot().reuse.generationHitCount,
    ).toBeGreaterThan(0);
  });

  it("reuses identical output even when the interaction quality label changes", () => {
    const { canvas } = createCanvasFixture(1, 1);
    const raster = new Raster({ tileSize: 1 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });

    renderer.render({ quality: "full" });
    renderer.render({ quality: "interactive" });
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(1);
  });

  it("regenerates canonical World pixels after an equal-size interactive preview", () => {
    const { canvas, tileContexts } = createCanvasFixture(1, 1);
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    top.opacity = 0.7;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        bottom.raster.setPixel(
          { x, y },
          (x + y) % 2 === 0
            ? { r: 240, g: 10, b: 20, a: 255 }
            : { r: 10, g: 30, b: 220, a: 255 },
        );
        top.raster.setPixel(
          { x, y },
          (x + y) % 2 === 0
            ? { r: 30, g: 230, b: 50, a: 160 }
            : { r: 220, g: 20, b: 180, a: 40 },
        );
      }
    }
    const camera = new Camera();
    camera.setZoom(0.5);
    const renderer = new CanvasRenderer({ canvas, world, camera });

    renderer.render({ quality: "interactive" });
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(1);
    const previewPixels = Array.from(
      vi.mocked(tileContexts[0]?.putImageData).mock.calls[0]?.[0]?.data ?? [],
    );

    renderer.render({ quality: "full" });
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(1);
    expect(renderer.diagnostics.getSnapshot().tiles.generatedPixelBytes).toBe(
      4,
    );
    const settledPixels = Array.from(
      vi.mocked(tileContexts[0]?.putImageData).mock.calls.at(-1)?.[0]?.data ??
        [],
    );
    expect(settledPixels).not.toEqual(previewPixels);
  });

  it("adapts screen-space render and retention margins to zoom with bounded Tile counts", () => {
    const { canvas } = createCanvasFixture(128, 128);
    const camera = new Camera();
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      raster: new Raster({ tileSize: 128 }),
    });

    renderer.render();
    const normal = renderer.diagnostics.getSnapshot().coverage;
    expect(normal.renderMarginTiles).toBe(4);
    expect(normal.renderMarginTiles * 128 * camera.zoom).toBe(512);
    expect(normal.retentionMarginTiles).toBeGreaterThan(
      normal.renderMarginTiles,
    );

    camera.setZoom(0.5);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().coverage.renderMarginTiles).toBe(
      8,
    );
    expect(
      renderer.diagnostics.getSnapshot().coverage.renderMarginTiles *
        128 *
        camera.zoom,
    ).toBe(512);

    camera.setZoom(2);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().coverage.renderMarginTiles).toBe(
      2,
    );

    camera.setZoom(0.01);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().coverage.renderMarginTiles).toBe(
      24,
    );
  });

  it("reuses adaptive warm coverage after a large pan at small zoom", () => {
    const { canvas } = createCanvasFixture(128, 128);
    const raster = new Raster({ tileSize: 128 });
    raster.setPixel({ x: 2048, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const camera = new Camera({ zoom: 0.125 });
    const renderer = new CanvasRenderer({ canvas, camera, raster });

    renderer.render({ prefetch: true });
    renderer.render({ prefetch: true });
    expect(renderer.diagnostics.getSnapshot().zones.warmCount).toBe(1);

    camera.setPan(2048, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(
      renderer.diagnostics.getSnapshot().reuse.generationHitCount,
    ).toBeGreaterThan(0);
  });

  it("uses slow motion as base coverage and gives bounded forward work priority before trailing work", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const { canvas } = createCanvasFixture(64, 64);
      const raster = new Raster({ tileSize: 64 });
      raster.setPixel({ x: 640, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
      raster.setPixel({ x: -64, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
      raster.setPixel({ x: -640, y: 0 }, { r: 3, g: 0, b: 0, a: 255 });
      const camera = new Camera();
      const renderer = new CanvasRenderer({ canvas, camera, raster });
      renderer.render();

      clock.mockReturnValue(1000);
      camera.setPan(1, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      expect(
        renderer.diagnostics.getSnapshot().coverage.directionalLookaheadTiles,
      ).toBe(0);

      clock.mockReturnValue(1016);
      camera.setPan(65, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      const moving = renderer.diagnostics.getSnapshot().coverage;
      expect(moving.directionX).toBe(1);
      expect(moving.directionalLookaheadTiles).toBeGreaterThan(0);
      expect(moving.directionalLookaheadTiles).toBeLessThanOrEqual(16);
      expect(moving.prefetchCompletedCount).toBe(0);

      renderer.render({ quality: "interactive", prefetch: true });
      const forward = renderer.diagnostics.getSnapshot().coverage;
      expect(forward.prefetchCompletedCount).toBe(1);
      expect(forward.missingWarmCount).toBe(1);

      clock.mockReturnValue(1032);
      camera.setPan(1, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      const reversed = renderer.diagnostics.getSnapshot();
      expect(reversed.coverage.directionX).toBe(-1);
      expect(reversed.coverage.directionalLookaheadTiles).toBeGreaterThan(0);
      expect(reversed.zones.retainedCount).toBeGreaterThan(0);

      renderer.render({ quality: "interactive", prefetch: true });
      expect(
        renderer.diagnostics.getSnapshot().coverage.prefetchCompletedCount,
      ).toBeGreaterThan(forward.prefetchCompletedCount);

      clock.mockReturnValue(1048);
      camera.setPan(4097, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      expect(
        renderer.diagnostics.getSnapshot().coverage.directionalLookaheadTiles,
      ).toBe(16);
    } finally {
      clock.mockRestore();
    }
  });

  it("starts visible work before a forward prefetch batch and obeys the Core candidate budget", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const { canvas } = createCanvasFixture(2, 2);
      const raster = new Raster({ tileSize: 1 });
      raster.setPixel({ x: 64, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
      for (let y = 0; y < 5; y += 1) {
        for (let x = 66; x < 106; x += 1) {
          raster.setPixel({ x, y }, { r: 2, g: 0, b: 0, a: 255 });
        }
      }
      const camera = new Camera();
      const renderer = new CanvasRenderer({ canvas, camera, raster });
      renderer.render();

      clock.mockReturnValue(16);
      camera.setPan(64, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      const visible = renderer.diagnostics.getSnapshot();
      expect(visible.tiles.renderedCount).toBe(1);
      expect(visible.coverage.prefetchRequestedCount).toBe(0);

      renderer.render({ quality: "interactive", prefetch: true });
      const warm = renderer.diagnostics.getSnapshot();
      expect(warm.coverage.prefetchRequestedCount).toBeGreaterThan(0);
      expect(warm.coverage.prefetchRequestedCount).toBeLessThanOrEqual(128);
      expect(warm.coverage.prefetchCompletedCount).toBeLessThanOrEqual(128);
      expect(renderer.hasPendingRender).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps one interactive LOD under movement pressure and refines when settled", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const { canvas } = createCanvasFixture(128, 128);
      const raster = new Raster({ tileSize: 128 });
      raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
      raster.setPixel({ x: 128, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
      const camera = new Camera();
      const renderer = new CanvasRenderer({ canvas, camera, raster });

      renderer.render({ quality: "interactive" });
      expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(
        64,
      );

      clock.mockReturnValue(16);
      camera.setPan(128, 0);
      renderer.render({ quality: "interactive", prefetch: true });
      const pressured = renderer.diagnostics.getSnapshot();
      expect(pressured.coverage.pressure).toBe("high");
      expect(pressured.coverage.interactiveOutputTileSize).toBe(64);
      expect(pressured.tiles.generatedPixelBytes).toBe(64 * 64 * 4);
      expect(pressured.coverage.prefetchCompletedCount).toBe(0);
      expect(pressured.tiles.renderedCount).toBe(1);

      renderer.render({ quality: "full" });
      const settled = renderer.diagnostics.getSnapshot();
      expect(settled.coverage.pressure).toBe("normal");
      expect(settled.coverage.interactiveOutputTileSize).toBeNull();
      expect(settled.quality?.outputTileSize).toBe(128);
    } finally {
      clock.mockRestore();
    }
  });

  it("projects full-quality warm pixels during interactive pan before generating its lower resolution", () => {
    const { canvas, context, tileCanvases } = createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 4, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });
    renderer.render({ prefetch: true });
    renderer.render({ prefetch: true });
    vi.mocked(context.drawImage).mockClear();

    camera.setPan(4, 0);
    renderer.render({ quality: "interactive" });

    expect(tileCanvases[1]?.width).toBe(4);
    expect(
      vi
        .mocked(context.drawImage)
        .mock.calls.some(
          (call) => call[0] === tileCanvases[1] && call[1] === 0,
        ),
    ).toBe(true);
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(1);
    expect(
      renderer.diagnostics.getSnapshot().reuse.presentationHitCount,
    ).toBeGreaterThan(0);
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(2);

    renderer.render({ quality: "full" });
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(
      renderer.diagnostics.getSnapshot().reuse.generationHitCount,
    ).toBeGreaterThan(0);
  });

  it("does not finish an interactive continuation as settled full quality", () => {
    const { canvas } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    }
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });

    renderer.render({ quality: "interactive" });
    expect(renderer.hasPendingRender).toBe(true);
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(1);

    renderer.render({ quality: "full" });
    expect(renderer.diagnostics.getSnapshot().quality?.outputTileSize).toBe(2);
    expect(
      renderer.diagnostics.getSnapshot().progressive.cancelledRequestCount,
    ).toBe(1);
    renderer.render({ quality: "full" });
    expect(renderer.hasPendingRender).toBe(false);
    expect(renderer.diagnostics.getSnapshot().zones.visibleCount).toBe(130);
  });

  it("retains completed partial regions when camera motion cancels a request", () => {
    const { canvas } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    }
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.render();
    expect(renderer.hasPendingRender).toBe(true);
    const provisionalCount =
      renderer.diagnostics.getSnapshot().reuse.provisionalRegionCount;
    expect(provisionalCount).toBeGreaterThan(0);
    expect(provisionalCount).toBeLessThanOrEqual(128);

    camera.setPan(2, 0);
    renderer.render();
    for (let batch = 0; renderer.hasPendingRender && batch < 10; batch += 1) {
      renderer.render();
    }
    expect(renderer.hasPendingRender).toBe(false);
    expect(
      renderer.diagnostics.getSnapshot().reuse.generationHitCount,
    ).toBeGreaterThan(0);
    expect(renderer.diagnostics.getSnapshot().zones.visibleCount).toBe(129);
    expect(
      renderer.diagnostics.getSnapshot().progressive.cancelledRequestCount,
    ).toBe(1);
  });

  it("does not project an old source revision after a camera change", () => {
    const { canvas, context } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.render();
    vi.mocked(context.drawImage).mockClear();
    raster.clear();
    renderer.markSourceChanged();
    camera.setPan(1, 0);
    renderer.render();

    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("renders visible Tiles before warming nearby Tiles and reuses warm pixels on pan", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 4, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, camera, raster });

    renderer.render({ prefetch: true });
    expect(renderer.diagnostics.getSnapshot().zones).toEqual({
      visibleCount: 1,
      warmCount: 0,
      retainedCount: 0,
    });
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(renderer.hasPendingRender).toBe(true);

    renderer.render({ prefetch: true });
    expect(renderer.diagnostics.getSnapshot().zones.warmCount).toBe(1);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(tileContexts).toHaveLength(1);

    camera.setPan(4, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(tileContexts).toHaveLength(2);
    expect(raster.getPixel({ x: 4, y: 0 })).toEqual({
      r: 2,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it("keeps results outside the warm margin and discards them past retention", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, camera, raster });

    renderer.render();
    const margin =
      renderer.diagnostics.getSnapshot().coverage.renderMarginTiles;
    const retention =
      renderer.diagnostics.getSnapshot().coverage.retentionMarginTiles;
    camera.setPan((margin + 2) * raster.tileSize, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().zones.retainedCount).toBe(1);

    camera.setPan(0, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(tileContexts).toHaveLength(1);

    camera.setPan((retention + 2) * raster.tileSize, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().zones.retainedCount).toBe(0);
    camera.setPan(0, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(1);
    expect(tileContexts).toHaveLength(2);
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
  });

  it("reuses unchanged results but removes an edited Tile from retained coverage", () => {
    const { canvas, tileContexts } = createCanvasFixture(4, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    renderer.markSourceChanged([{ x: 0, y: 0 }]);
    renderer.render();

    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
    expect(renderer.diagnostics.getSnapshot().zones.visibleCount).toBe(1);
    expect(tileContexts[1]?.putImageData).toHaveBeenCalledOnce();
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it("retains a bounded World result during a short excursion past its edge", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const world = new World({
      tileSize: 2,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, camera, world });

    renderer.render();
    const margin =
      renderer.diagnostics.getSnapshot().coverage.renderMarginTiles;
    camera.setPan((margin + 2) * world.tileSize, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().zones.retainedCount).toBe(1);
    camera.setPan(0, 0);
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
  });

  it("rejects an unsupported interaction quality at the Canvas boundary", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster: new Raster({ tileSize: 2 }),
    });

    expect(() =>
      renderer.render({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        quality: "preview",
      }),
    ).toThrow(`[${RendererErrorDefinitions.INVALID_RENDER_QUALITY.code}]`);
  });

  it("keeps an explicit synchronous render ahead of pending warm work", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 4, y: 0 }, { r: 2, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render({ prefetch: true });
    expect(renderer.hasPendingRender).toBe(true);
    raster.setPixel({ x: 0, y: 0 }, { r: 3, g: 0, b: 0, a: 255 });
    renderer.markSourceChanged([{ x: 0, y: 0 }]);
    renderer.render();

    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(1);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(2);
    expect(renderer.hasPendingRender).toBe(false);
  });

  it("exposes Canvas and Core counters and keeps old snapshots stable", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    expect(renderer.diagnostics.getSnapshot().rendering).toBeUndefined();
    renderer.render();
    const first = renderer.diagnostics.getSnapshot();
    expect(first.tiles.renderedCount).toBe(1);
    expect(first.regions).toMatchObject({
      generatedCount: 1,
      presentedCount: 1,
      removedCount: 0,
      visibleCount: 1,
      pendingCount: 0,
    });
    expect(first.presentation).toMatchObject({
      uploadedRegionCount: 1,
      drawnRegionCount: 1,
    });
    expect(Object.isFrozen(first.presentation)).toBe(true);
    renderer.render();
    expect(first.presentation.uploadedRegionCount).toBe(1);
    expect(
      renderer.diagnostics.getSnapshot().presentation.uploadedRegionCount,
    ).toBe(0);
  });

  it("records opted-in Canvas presentation, upload, and draw timings", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
      diagnostics: { timings: true },
    });

    renderer.render();
    const snapshot = renderer.diagnostics.getSnapshot();
    expect(snapshot.rendering?.coreDurationMs.current).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      snapshot.presentation.presentationDurationMs?.current,
    ).toBeGreaterThanOrEqual(0);
    expect(
      snapshot.presentation.uploadDurationMs?.current,
    ).toBeGreaterThanOrEqual(0);
    expect(
      snapshot.presentation.drawDurationMs?.current,
    ).toBeGreaterThanOrEqual(0);
  });

  it("starts Canvas and Core timing only while diagnostics are enabled", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    expect(renderer.diagnostics.getSnapshot().rendering).toBeUndefined();
    expect(
      renderer.diagnostics.getSnapshot().presentation.presentationDurationMs,
    ).toBeUndefined();

    renderer.configureDiagnostics({ timings: true });
    expect(renderer.diagnostics.getSnapshot().rendering).toBeUndefined();
    renderer.render();
    const openSnapshot = renderer.diagnostics.getSnapshot();
    expect(
      openSnapshot.rendering?.coreDurationMs.current,
    ).toBeGreaterThanOrEqual(0);
    expect(
      openSnapshot.presentation.presentationDurationMs?.current,
    ).toBeGreaterThanOrEqual(0);

    renderer.configureDiagnostics({ timings: false });
    const closedSnapshot = renderer.diagnostics.getSnapshot();
    expect(closedSnapshot.rendering).toBeUndefined();
    expect(closedSnapshot.presentation.presentationDurationMs).toBeUndefined();
    expect(closedSnapshot.interaction.fullRenderCount).toBe(2);
    renderer.render();
    expect(
      renderer.diagnostics.getSnapshot().presentation.presentationDurationMs,
    ).toBeUndefined();

    renderer.configureDiagnostics({ timings: true });
    expect(renderer.diagnostics.getSnapshot().rendering).toBeUndefined();
    expect(
      renderer.diagnostics.getSnapshot().presentation.presentationDurationMs,
    ).toBeUndefined();
    renderer.render();
    expect(
      renderer.diagnostics.getSnapshot().rendering?.coreDurationMs.current,
    ).toBeGreaterThanOrEqual(0);
    expect(renderer.diagnostics.getSnapshot().interaction.fullRenderCount).toBe(
      4,
    );
  });

  it("rejects invalid runtime diagnostics options", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster: new Raster({ tileSize: 2 }),
    });

    expect(() =>
      renderer.configureDiagnostics({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        timings: "on",
      }),
    ).toThrow(`[${RendererErrorDefinitions.INVALID_DIAGNOSTICS_OPTIONS.code}]`);
  });

  it("resolves rendering demand through Rendering Core before presentation", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    const render = vi.spyOn(RenderingCore.prototype, "render");

    new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    }).render();

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ source: { raster } }),
    );
    render.mockRestore();
  });

  it("keeps sparse batches pending until their continuation completes", () => {
    const { canvas, context } = createCanvasFixture(258, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 258; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();

    expect(renderer.hasPendingRender).toBe(true);
    expect(vi.mocked(context.drawImage).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(context.drawImage).mock.calls.length).toBeLessThanOrEqual(
      128,
    );

    for (let batch = 0; renderer.hasPendingRender && batch < 10; batch += 1) {
      renderer.render();
    }

    expect(renderer.hasPendingRender).toBe(false);
    expect(context.drawImage).toHaveBeenCalledTimes(129);
    expect(
      renderer.diagnostics.getSnapshot().presentation
        .completionDeltaRegionCount,
    ).toBe(1);
    expect(
      renderer.diagnostics.getSnapshot().presentation
        .skippedAlreadyPresentedRegionCount,
    ).toBe(128);
  });

  it("updates a changed late Tile without regenerating unchanged coverage", () => {
    const { canvas, context } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });
    renderer.render();
    renderer.render();
    vi.mocked(context.drawImage).mockClear();
    vi.mocked(context.clearRect).mockClear();

    raster.setPixel({ x: 258, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    renderer.markSourceChanged([{ x: 129, y: 0 }]);
    renderer.render();

    expect(renderer.hasPendingRender).toBe(false);
    expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(1);
    expect(
      vi
        .mocked(context.drawImage)
        .mock.calls.some((call) => call.slice(1).join(":") === "258:0:2:2"),
    ).toBe(true);
  });

  it("advances interactive pixels across repeated source changes without completing a viewport", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    for (let x = 0; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });
    renderer.render();
    renderer.render();
    vi.mocked(context.drawImage).mockClear();

    for (const blue of [64, 128, 255]) {
      raster.setPixel({ x: 258, y: 0 }, { r: 0, g: 0, b: blue, a: 255 });
      renderer.markSourceChanged([{ x: 129, y: 0 }]);
      renderer.render();
      expect(renderer.hasPendingRender).toBe(false);
      expect(vi.mocked(context.drawImage).mock.calls.at(-1)?.slice(1)).toEqual([
        258, 0, 2, 2,
      ]);
    }

    expect(context.drawImage).toHaveBeenCalledTimes(3);
    const latestUpload = vi
      .mocked(tileContexts[129]?.putImageData)
      .mock.calls.at(-1)?.[0];
    expect(Array.from(latestUpload?.data.slice(0, 4) ?? [])).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("reprojects cached tiles when panning a fully visible bounded World", () => {
    const { canvas, context } = createCanvasFixture(300, 4);
    const world = new World({
      tileSize: 2,
      bounds: { x: 0, y: 0, width: 260, height: 2 },
    });
    for (let x = 0; x < 260; x += 2) {
      world
        .getLayer(0)
        .raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    const camera = new Camera({ panX: -10, panY: -1 });
    const renderer = new CanvasRenderer({ canvas, world, camera });

    renderer.render();
    expect(renderer.hasPendingRender).toBe(true);
    for (
      let attempt = 0;
      renderer.hasPendingRender && attempt < 16;
      attempt += 1
    ) {
      renderer.render();
    }
    expect(renderer.hasPendingRender).toBe(false);
    vi.mocked(context.clearRect).mockClear();
    vi.mocked(context.drawImage).mockClear();

    camera.setPan(-12, -1);
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 300, 4);
    expect(vi.mocked(context.drawImage).mock.calls[0]?.slice(1)).toEqual([
      12, 1, 2, 2,
    ]);
    expect(renderer.hasPendingRender).toBe(false);
  });

  it("preserves the visible frame while newly allocated tiles are pending", () => {
    const { canvas, context } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    vi.mocked(context.clearRect).mockClear();
    vi.mocked(context.drawImage).mockClear();
    for (let x = 2; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    renderer.render();

    expect(renderer.hasPendingRender).toBe(true);
    expect(vi.mocked(context.drawImage).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(context.drawImage).mock.calls.length).toBeLessThanOrEqual(
      128,
    );
    expect(context.clearRect).not.toHaveBeenCalledWith(0, 0, 260, 2);

    for (let batch = 0; renderer.hasPendingRender && batch < 10; batch += 1) {
      renderer.render();
    }
    expect(renderer.hasPendingRender).toBe(false);
    expect(context.drawImage).toHaveBeenCalledTimes(129);
  });

  it("cancels an unfinished request without clearing the visible frame", () => {
    const { canvas, context } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    for (let x = 2; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    renderer.render();
    const presentedCountBeforeInvalidation = vi.mocked(context.drawImage).mock
      .calls.length;
    vi.mocked(context.clearRect).mockClear();
    renderer.invalidate();

    expect(renderer.hasPendingRender).toBe(true);
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(presentedCountBeforeInvalidation).toBeGreaterThan(0);
    expect(context.drawImage).toHaveBeenCalledTimes(
      presentedCountBeforeInvalidation,
    );
  });

  it("refreshes tiles edited while a continuation is pending", () => {
    const { canvas, tileContexts } = createCanvasFixture(260, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    for (let x = 2; x < 260; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    }
    renderer.render();
    raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    renderer.markSourceChanged();
    const continueRender = vi.spyOn(RenderingCore.prototype, "continueRender");
    renderer.render();
    expect(continueRender).not.toHaveBeenCalled();
    for (let index = 0; renderer.hasPendingRender && index < 10; index += 1) {
      renderer.render();
    }
    continueRender.mockRestore();

    expect(renderer.hasPendingRender).toBe(false);
    const latestUpload = vi.mocked(tileContexts[0]?.putImageData).mock
      .calls[1]?.[0];
    expect(Array.from(latestUpload?.data.slice(0, 4) ?? [])).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("clears regions absent from a completed replacement frame", () => {
    const { canvas, context } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      raster,
    });

    renderer.render();
    raster.clear();
    renderer.invalidate();
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it("removes an old tile when a completed replacement omits its bounds", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(4, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();
    vi.mocked(context.clearRect).mockClear();
    vi.mocked(context.drawImage).mockClear();

    raster.clear();
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    renderer.invalidate();
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(2, 0, 2, 2);
    expect(context.clearRect).not.toHaveBeenCalledWith(0, 0, 4, 2);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(ownerDocument.createElement).toHaveBeenCalledTimes(2);
  });

  it("clears negative world bounds through the camera and pixel ratio", () => {
    const { canvas, context } = createCanvasFixture(8, 8);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: -2, y: -2 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ panX: -3, panY: -3, zoom: 2 }),
    });
    renderer.resize(8, 8, 2);
    renderer.render();
    vi.mocked(context.clearRect).mockClear();

    raster.clear();
    renderer.invalidate();
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(4, 4, 8, 8);
  });

  it("removes fully erased tile pixels without uploading transparent output", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();
    vi.mocked(context.clearRect).mockClear();

    raster.erasePixel({ x: 0, y: 0 }, 1);
    renderer.invalidate();
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it("removes render-empty presentation while retaining hidden RGB in its Raster", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();
    vi.mocked(context.clearRect).mockClear();

    raster.setPixel({ x: 0, y: 0 }, { r: 25, g: 50, b: 75, a: 0 });
    renderer.invalidate();
    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledOnce();
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 25,
      g: 50,
      b: 75,
      a: 0,
    });
  });

  it.each(["hidden", "removed"] as const)(
    "removes output from a %s World layer",
    (change) => {
      const { canvas, context } = createCanvasFixture(2, 2);
      const world = new World({ tileSize: 2 });
      const layer = world.addLayer();
      layer.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
      const renderer = new CanvasRenderer({
        canvas,
        world,
        camera: new Camera(),
      });
      renderer.render();
      vi.mocked(context.clearRect).mockClear();
      vi.mocked(context.drawImage).mockClear();

      if (change === "hidden") {
        layer.visible = false;
      } else {
        world.removeLayer(layer);
      }
      renderer.invalidate();
      renderer.render();

      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
      expect(context.drawImage).not.toHaveBeenCalled();
    },
  );

  it("renders a hydrated World through the normal composition path", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 2);
    const source = new World({ tileSize: 2 });
    source
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 12, g: 34, b: 56, a: 255 });
    const hydrated = deserializeDocument(serializeDocument(source));

    new CanvasRenderer({
      canvas,
      camera: new Camera(),
      world: hydrated,
    }).render();

    const tileContext = tileContexts[0];
    if (tileContext === undefined) {
      throw new Error("Expected a hydrated World tile context.");
    }
    const imageData = vi.mocked(tileContext.putImageData).mock.calls[0]?.[0];
    if (imageData === undefined) {
      throw new Error("Expected hydrated World tile upload.");
    }
    expect(Array.from(imageData.data.slice(0, 4))).toEqual([12, 34, 56, 255]);
  });

  it("composes custom blend modes into the projected tile", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 100, g: 100, b: 100, a: 255 });
    const top = world.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 150, b: 50, a: 255 });
    top.blendMode = "multiply";
    const renderer = new CanvasRenderer({
      canvas,
      camera: new Camera(),
      world,
    });
    renderer.render();
    const tileContext = tileContexts[0];
    if (tileContext === undefined) {
      throw new Error("Expected composed tile context");
    }
    const imageData = vi.mocked(tileContext.putImageData).mock.calls[0]?.[0];
    if (imageData === undefined) {
      throw new Error("Expected composed tile upload");
    }
    expect(Array.from(imageData.data.slice(0, 4))).toEqual([78, 59, 20, 255]);
    renderer.render();
    expect(tileContext.putImageData).toHaveBeenCalledOnce();
  });

  it("captures the source instead of following later config mutations", () => {
    const { canvas, context } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const config = { canvas, camera: new Camera(), world };
    const renderer = new CanvasRenderer(config);
    config.world = new World();
    renderer.render();
    expect(renderer.world).toBe(world);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(Object.isFrozen(config)).toBe(false);
  });

  it("resolves the viewport once regardless of contributing layer count", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    world.addLayer();
    world.addLayer();
    const camera = new Camera();
    const visible = vi.spyOn(camera, "visibleWorldRect");
    new CanvasRenderer({ canvas, camera, world }).render();
    expect(visible).toHaveBeenCalledOnce();
  });

  it("rejects missing or conflicting sources instead of silently falling back", () => {
    const { canvas } = createCanvasFixture();
    const camera = new Camera();
    // @ts-expect-error JavaScript callers must also choose exactly one source.
    expect(() => new CanvasRenderer({ canvas, camera })).toThrow(
      "EC_RENDERER_0004",
    );
    expect(() => {
      // @ts-expect-error Supplying both sources is intentionally invalid.
      return new CanvasRenderer({
        canvas,
        camera,
        raster: new Raster(),
        world: new World(),
      });
    }).toThrow("EC_RENDERER_0004");
  });
  it("uploads one precomposited World tile with layer opacity", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    top.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    top.opacity = 0.5;
    const alphas: number[] = [];
    vi.mocked(context.drawImage).mockImplementation(() => {
      alphas.push(context.globalAlpha);
    });
    const renderer = new CanvasRenderer({
      canvas,
      world,
      camera: new Camera(),
    });
    renderer.render();
    expect(alphas).toEqual([1]);
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(tileContexts).toHaveLength(1);
    expect(
      vi
        .mocked(tileContexts[0]?.putImageData ?? context.putImageData)
        .mock.calls[0]?.[0].data.slice(0, 4),
    ).toEqual(new Uint8ClampedArray([128, 0, 128, 255]));
    world.moveLayer(top, 0);
    renderer.invalidate();
    alphas.length = 0;
    vi.mocked(context.drawImage).mockClear();
    renderer.render();
    expect(alphas).toEqual([1]);
    expect(vi.mocked(context.drawImage).mock.calls).toHaveLength(1);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(2);
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it("skips hidden, zero-opacity, and empty layers while updating changed composition", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    const layer = world.getLayer(0);
    world.addLayer();
    layer.raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      world,
      camera: new Camera(),
    });
    layer.visible = false;
    renderer.render();
    layer.visible = true;
    layer.opacity = 0;
    renderer.render();
    expect(tileContexts).toHaveLength(0);
    expect(context.drawImage).not.toHaveBeenCalled();
    layer.opacity = 1;
    renderer.render();
    layer.name = "New name";
    layer.opacity = 0.2;
    renderer.invalidate();
    renderer.render();
    expect(tileContexts).toHaveLength(1);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(2);
  });

  it("clips negative World bounds through the Camera and DPR and culls outside tiles", () => {
    const { canvas, context, tileContexts } = createCanvasFixture(16, 16);
    const world = new World({
      tileSize: 2,
      bounds: { x: -1, y: -1, width: 2, height: 2 },
    });
    world
      .getLayer(0)
      .raster.setPixel({ x: -1, y: -1 }, { r: 1, g: 2, b: 3, a: 255 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 2, y: 2 }, { r: 1, g: 2, b: 3, a: 255 });
    const camera = new Camera({ panX: -2, panY: -2, zoom: 2 });
    const renderer = new CanvasRenderer({ canvas, world, camera });
    renderer.resize(16, 16, 2);
    renderer.render();
    expect(context.rect).toHaveBeenCalledWith(4, 4, 8, 8);
    expect(context.clip).toHaveBeenCalledOnce();
    expect(tileContexts).toHaveLength(1);
    camera.setPan(100, camera.panY);
    vi.mocked(context.drawImage).mockClear();
    renderer.render();
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("restores context state even if an upload fails", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(2, 2);
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 0, a: 255 });
    vi.mocked(ownerDocument.createElement).mockImplementation(() => {
      throw new Error("upload failure");
    });
    const renderer = new CanvasRenderer({
      canvas,
      world,
      camera: new Camera(),
    });
    expect(() => renderer.render()).toThrow("upload failure");
    expect(context.restore).toHaveBeenCalledOnce();
  });
});

describe("CanvasRenderer construction", () => {
  it("passes its result cache budget to Core and releases cached pixels on dispose", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
      resultCacheByteBudget: 16,
    });
    renderer.render();
    expect(renderer.diagnostics.getSnapshot().resultCache.bytes).toBe(16);
    renderer.dispose();
    expect(renderer.diagnostics.getSnapshot().resultCache).toMatchObject({
      entries: 0,
      bytes: 0,
    });
  });

  it("is available through the renderer entry point and implements Renderer", () => {
    const { canvas } = createCanvasFixture();
    const raster = new Raster({ tileSize: 2 });
    const camera = new Camera();
    const config: CanvasRendererConfig = { canvas, raster, camera };
    const renderer: Renderer = new CanvasRenderer(config);

    expect(renderer).toBeInstanceOf(CanvasRenderer);
    expect(() => renderer.dispose()).not.toThrow();
  });

  it("keeps its dependencies fixed after construction", () => {
    const { canvas } = createCanvasFixture();
    const raster = new Raster({ tileSize: 2 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    expect(renderer.canvas).toBe(canvas);
    expect(renderer.raster).toBe(raster);
    expect(renderer.raster.tileSize).toBe(2);
    expect(renderer.camera).toBe(camera);

    if (false) {
      // @ts-expect-error Renderer dependencies are readonly.
      renderer.canvas = canvas;
      // @ts-expect-error Renderer dependencies are readonly.
      renderer.raster = raster;
      // @ts-expect-error Renderer dependencies are readonly.
      renderer.camera = camera;
    }
  });

  it("rejects a canvas that cannot provide a 2D context", () => {
    const canvas = {
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const createRenderer = () =>
      new CanvasRenderer({
        canvas,
        raster: new Raster(),
        camera: new Camera(),
      });

    expect(createRenderer).toThrow(RendererError);
    expect(createRenderer).toThrow(Error);
    expect(createRenderer).toThrow(
      `[${RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT.code}]`,
    );

    try {
      createRenderer();
    } catch (error) {
      expect(error).toMatchObject({
        code: RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT.code,
        name: "RendererError",
      });
    }
  });
});

describe("CanvasRenderer resize", () => {
  it.each([
    [0, 0],
    [1, 1],
    [1_920, 1_080],
  ])("sets a %d by %d backing buffer", (width, height) => {
    const { canvas } = createCanvasFixture();
    const renderer = new CanvasRenderer({
      canvas,
      raster: new Raster(),
      camera: new Camera(),
    });

    renderer.resize(width, height);

    expect(canvas.width).toBe(width);
    expect(canvas.height).toBe(height);
  });

  it.each([
    [-1, 100],
    [100, -1],
    [1.5, 100],
    [100, 1.5],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])("rejects invalid size %s by %s atomically", (width, height) => {
    const { canvas } = createCanvasFixture(20, 10);
    const renderer = new CanvasRenderer({
      canvas,
      raster: new Raster(),
      camera: new Camera(),
    });

    expect(() => renderer.resize(width, height)).toThrow(RendererRangeError);
    expect(() => renderer.resize(width, height)).toThrow(RangeError);
    expect(() => renderer.resize(width, height)).toThrow(
      `[${RendererErrorDefinitions.INVALID_CANVAS_SIZE.code}]`,
    );
    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(10);
  });

  it("rejects non-number dimensions", () => {
    const { canvas } = createCanvasFixture();
    const renderer = new CanvasRenderer({
      canvas,
      raster: new Raster(),
      camera: new Camera(),
    });

    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      renderer.resize("100", 100);
    }).toThrow(RendererTypeError);
    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      renderer.resize("100", 100);
    }).toThrow(TypeError);
  });
});

describe("CanvasRenderer rendering", () => {
  it("clears an empty raster without drawing or allocating tiles", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 2 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });

    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 4, 4);
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(ownerDocument.createElement).not.toHaveBeenCalled();
  });

  it("clears and returns safely for a zero-sized canvas", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(0, 0);
    const renderer = new CanvasRenderer({
      canvas,
      raster: new Raster({ tileSize: 2 }),
      camera: new Camera(),
    });

    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(ownerDocument.createElement).not.toHaveBeenCalled();
  });

  it("uploads and draws positive world pixels at projected coordinates", () => {
    const { canvas, context, tileCanvases, tileContexts } = createCanvasFixture(
      4,
      4,
    );
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 64, b: 32, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 2 }),
    });

    renderer.render();

    const tileCanvas = tileCanvases[0];
    const tileContext = tileContexts[0];
    expect(tileCanvas?.width).toBe(2);
    expect(tileCanvas?.height).toBe(2);
    expect(context.drawImage).toHaveBeenCalledWith(tileCanvas, 0, 0, 4, 4);

    if (tileContext === undefined) {
      throw new Error("Expected a tile context.");
    }

    const imageData = vi.mocked(tileContext.putImageData).mock.calls[0]?.[0];

    expect(Array.from(imageData?.data ?? [])).toEqual([
      255, 64, 32, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("renders negative world coordinates in the correct tile", () => {
    const { canvas, context } = createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: -1, y: -1 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ panX: -2, panY: -2, zoom: 2 }),
    });

    renderer.render();

    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(vi.mocked(context.drawImage).mock.calls[0]?.slice(1)).toEqual([
      0, 0, 4, 4,
    ]);
  });

  it("draws adjacent tiles continuously at a fractional zoom", () => {
    const { canvas, context } = createCanvasFixture(3, 3);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 1, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ panX: 1, panY: 0, zoom: 1.5 }),
    });

    renderer.render();

    const drawCalls = vi.mocked(context.drawImage).mock.calls;
    expect(drawCalls).toHaveLength(2);
    expect(drawCalls[0]?.slice(1)).toEqual([-2, 0, 4, 3]);
    expect(drawCalls[1]?.slice(1)).toEqual([2, 0, 3, 3]);
  });

  it("shares symmetric snapped boundaries between draw and clear paths", () => {
    const { canvas, context } = createCanvasFixture(4, 4);
    const core = new RenderingCore();
    const backend = new CanvasBackend(
      canvas,
      new Camera({ zoom: 0.25 }),
      null,
      new CanvasDiagnostics(core, false),
    );
    const regions = [-2, 0].map((x) => ({
      bounds: { x, y: 0, width: 2, height: 2 },
      pixels: new Uint8Array(16).fill(255),
    }));
    backend.present(
      {
        identity: { requestId: 1, viewportKey: "test", sourceRevision: "0" },
        regions,
      },
      backend.target,
    );
    expect(
      vi.mocked(context.drawImage).mock.calls.map((call) => call.slice(1)),
    ).toEqual([
      [-1, 0, 1, 1],
      [0, 0, 1, 1],
    ]);

    vi.mocked(context.clearRect).mockClear();
    backend.presentRegions(regions);
    expect(vi.mocked(context.clearRect).mock.calls).toEqual([
      [-1, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
    vi.mocked(context.clearRect).mockClear();
    backend.clearRegions(regions.map((region) => region.bounds));
    expect(vi.mocked(context.clearRect).mock.calls).toEqual([
      [-1, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it("skips regions with zero snapped width or height", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(1, 1);
    const core = new RenderingCore();
    const backend = new CanvasBackend(
      canvas,
      new Camera({ zoom: 0.05 }),
      null,
      new CanvasDiagnostics(core, false),
    );
    const regions = [
      {
        bounds: { x: 0, y: 8, width: 8, height: 8 },
        pixels: new Uint8Array(8 * 8 * 4).fill(255),
      },
      {
        bounds: { x: 8, y: 0, width: 8, height: 8 },
        pixels: new Uint8Array(8 * 8 * 4).fill(255),
      },
    ];
    backend.presentRegions(regions);
    backend.clearRegions(regions.map((region) => region.bounds));
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(ownerDocument.createElement).not.toHaveBeenCalled();
  });

  it("draws only tiles intersecting the visible half-open range", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 200, y: 200 }, { r: 0, g: 255, b: 0, a: 255 });
    raster.setPixel({ x: -200, y: -200 }, { r: 0, g: 0, b: 255, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });

    renderer.render();

    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(ownerDocument.createElement).toHaveBeenCalledTimes(1);
  });

  it("does not draw while viewing a distant blank region", () => {
    const { canvas, context } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ panX: 1_000_000, panY: 1_000_000 }),
    });

    renderer.render();

    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("reuses coordinate canvases while uploading current pixels every frame", () => {
    const { canvas, ownerDocument, tileContexts } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });

    renderer.render();
    raster.setPixel({ x: 1, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    renderer.markSourceChanged([{ x: 0, y: 0 }]);
    renderer.render();

    expect(ownerDocument.createElement).toHaveBeenCalledTimes(1);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(2);
  });

  it("does not modify camera state or raster pixels", () => {
    const { canvas } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    const pixel = { x: 0, y: 0 };
    const color = { r: 12, g: 34, b: 56, a: 255 };
    const camera = new Camera({ panX: -1, panY: -2, zoom: 2 });
    raster.setPixel(pixel, color);
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.render();

    expect({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom }).toEqual(
      {
        panX: -1,
        panY: -2,
        zoom: 2,
      },
    );
    expect(raster.getPixel(pixel)).toEqual(color);
  });

  it("uses high-quality smoothing only when the effective device scale is below one", () => {
    const minified = createCanvasFixture(4, 4);
    const minifiedRaster = new Raster({ tileSize: 2 });
    minifiedRaster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    new CanvasRenderer({
      canvas: minified.canvas,
      raster: minifiedRaster,
      camera: new Camera({ zoom: 0.5 }),
    }).render();

    expect(minified.context.imageSmoothingEnabled).toBe(true);
    expect(minified.context.imageSmoothingQuality).toBe("high");

    const deviceMagnified = createCanvasFixture(8, 8);
    const deviceMagnifiedRaster = new Raster({ tileSize: 2 });
    deviceMagnifiedRaster.setPixel(
      { x: 0, y: 0 },
      { r: 255, g: 0, b: 0, a: 255 },
    );
    const renderer = new CanvasRenderer({
      canvas: deviceMagnified.canvas,
      raster: deviceMagnifiedRaster,
      camera: new Camera({ zoom: 0.75 }),
    });
    renderer.resize(8, 8, 2);
    renderer.render();

    expect(deviceMagnified.context.imageSmoothingEnabled).toBe(false);
    expect(deviceMagnified.context.imageSmoothingQuality).toBe("low");
  });

  it("downsamples in premultiplied form so transparent RGB cannot create halos", () => {
    const { canvas, tileContexts } = createCanvasFixture(1, 1);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 1, y: 0 }, { r: 0, g: 255, b: 0, a: 0 });
    new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.25 }),
    }).render();

    const lodUpload = tileContexts
      .flatMap((context) => vi.mocked(context.putImageData).mock.calls)
      .at(0)?.[0];
    expect(Array.from(lodUpload?.data ?? [])).toEqual([255, 0, 0, 64]);
  });

  it("uploads only the changed final LOD region", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 1);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.5 }),
    });

    renderer.render();
    renderer.render();
    const uploadCountBeforeChange = tileContexts.reduce(
      (count, context) =>
        count + vi.mocked(context.putImageData).mock.calls.length,
      0,
    );
    expect(uploadCountBeforeChange).toBe(2);

    raster.setPixel({ x: 3, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    renderer.markSourceChanged([{ x: 1, y: 0 }]);
    renderer.render();
    const uploadCountAfterChange = tileContexts.reduce(
      (count, context) =>
        count + vi.mocked(context.putImageData).mock.calls.length,
      0,
    );
    expect(uploadCountAfterChange).toBe(3);
  });

  it("composes World pixels at full resolution before generating a minified Tile", () => {
    const { canvas, tileContexts } = createCanvasFixture(1, 1);
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const top = world.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 128 });
    new CanvasRenderer({
      canvas,
      world,
      camera: new Camera({ zoom: 0.25 }),
    }).render();

    const lodUpload = tileContexts
      .flatMap((context) => vi.mocked(context.putImageData).mock.calls)
      .at(0)?.[0];
    expect(Array.from(lodUpload?.data ?? [])).toEqual([127, 0, 128, 64]);
  });

  it("returns safely when an extremely small zoom produces an infinite viewport", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: Number.MIN_VALUE }),
    });

    renderer.render();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 4, 4);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(ownerDocument.createElement).not.toHaveBeenCalled();
  });
});
