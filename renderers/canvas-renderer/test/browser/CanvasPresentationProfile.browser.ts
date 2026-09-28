import { afterEach, describe, expect, it, vi } from "vitest";

import { Camera, World } from "@reveriejs/core";

import { CanvasRenderer } from "../../index.js";
import CanvasBackend from "../../src/canvas/CanvasBackend.js";

const TILE_SIZE = 128;
const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 384;

afterEach(() => vi.restoreAllMocks());

/** Fixed #4 workload. Keep its source, paths, and call counts stable across runs. */
function createWorld(): World {
  const world = new World({
    tileSize: TILE_SIZE,
    bounds: { x: 0, y: 0, width: 1536, height: 1024 },
  });
  const base = world.getLayer(0).raster;
  const upper = world.addLayer().raster;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      base.setPixel(
        { x: x * TILE_SIZE + 8, y: y * TILE_SIZE + 8 },
        { r: 40 + x, g: 80 + y, b: 160, a: 255 },
      );
      if ((x + y) % 2 === 0) {
        upper.setPixel(
          { x: x * TILE_SIZE + 16, y: y * TILE_SIZE + 16 },
          { r: 200, g: 20 + x, b: 30 + y, a: 160 },
        );
      }
    }
  }
  return world;
}

function summarize(samples: readonly number[]): {
  total: number;
  average: number;
  p95: number;
  max: number;
} {
  const ordered = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    total,
    average: samples.length === 0 ? 0 : total / samples.length,
    p95: ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0,
    max: ordered.at(-1) ?? 0,
  };
}

describe("fixed Step 31A-H (#4) presentation profile", () => {
  it("records the same camera workload and verifies its final pixels", () => {
    // Core's time budget must not change the fixed number of continuations.
    const coreClock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const world = createWorld();
    const paths = [
      {
        name: "static",
        zoom: 2,
        positions: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        pixelHash: 1273985709,
      },
      {
        name: "small",
        zoom: 2,
        positions: [
          [0, 0],
          [8, 4],
          [16, 8],
          [24, 12],
        ],
        pixelHash: 1551754797,
      },
      {
        name: "large",
        zoom: 2,
        positions: [
          [0, 0],
          [256, 64],
          [512, 128],
          [768, 192],
        ],
        pixelHash: 2712997573,
      },
      {
        name: "zoomedOut",
        zoom: 0.5,
        positions: [
          [0, 0],
          [128, 64],
          [256, 128],
          [384, 192],
        ],
        pixelHash: 260433093,
      },
    ] as const;
    const results: Record<string, unknown>[] = [];

    for (const path of paths) {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const camera = new Camera({ zoom: path.zoom });
      const renderer = new CanvasRenderer({
        canvas,
        world,
        camera,
        diagnostics: { timings: true },
      });
      const full = vi.spyOn(CanvasBackend.prototype, "present");
      const partial = vi.spyOn(CanvasBackend.prototype, "presentRegions");
      const clear = vi.spyOn(CanvasRenderingContext2D.prototype, "clearRect");
      const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
      const upload = vi.spyOn(
        CanvasRenderingContext2D.prototype,
        "putImageData",
      );
      const durations: number[] = [];
      const canvasDurations: number[] = [];
      let completionDeltaRegions = 0;
      let skippedAlreadyPresentedRegions = 0;
      let warmExecuted = 0;
      let warmDeferred = 0;
      let comparisonCalls = 0;
      let comparisonBytes = 0;
      try {
        for (const [panX, panY] of path.positions) {
          camera.setPan(panX, panY);
          for (let call = 0; call < 4; call += 1) {
            const start = performance.now();
            renderer.render({
              quality: "interactive",
              prefetch: true,
              remainingFrameBudgetMs: call === 2 ? 0 : 4,
            });
            durations.push(performance.now() - start);
            const snapshot = renderer.diagnostics.getSnapshot();
            canvasDurations.push(
              snapshot.presentation.presentationDurationMs?.current ?? 0,
            );
            completionDeltaRegions +=
              snapshot.presentation.completionDeltaRegionCount;
            skippedAlreadyPresentedRegions +=
              snapshot.presentation.skippedAlreadyPresentedRegionCount;
            warmExecuted += snapshot.coverage.warmContinuationExecutedCount;
            warmDeferred += snapshot.coverage.warmContinuationDeferredCount;
            comparisonCalls += snapshot.presentation.rgbaComparisonCount;
            comparisonBytes += snapshot.presentation.rgbaComparedByteCount;
          }
        }
        const context = canvas.getContext("2d", { willReadFrequently: true });
        expect(context).not.toBeNull();
        const pixels = context!.getImageData(
          0,
          0,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
        ).data;
        const visibleAlpha = Array.from(pixels).filter(
          (value, index) => index % 4 === 3 && value > 0,
        ).length;
        expect(visibleAlpha).toBeGreaterThan(0);
        let pixelHash = 2166136261;
        for (const value of pixels) {
          pixelHash = Math.imul(pixelHash ^ value, 16777619);
        }
        expect(pixelHash >>> 0).toBe(path.pixelHash);
        results.push({
          name: path.name,
          calls: durations.length,
          render: summarize(durations),
          canvas: summarize(canvasDurations),
          comparisonCalls,
          comparisonBytes,
          uploads: upload.mock.calls.length,
          draws: draw.mock.calls.length,
          clears: clear.mock.calls.length,
          fullCanvasClears: clear.mock.calls.filter(
            ([x, y, width, height]) =>
              x === 0 &&
              y === 0 &&
              width === CANVAS_WIDTH &&
              height === CANVAS_HEIGHT,
          ).length,
          partialClears: clear.mock.calls.filter(
            ([x, y, width, height]) =>
              x !== 0 ||
              y !== 0 ||
              width !== CANVAS_WIDTH ||
              height !== CANVAS_HEIGHT,
          ).length,
          fullPresentations: full.mock.calls.length,
          partialPresentations: partial.mock.calls.length,
          completionDeltaRegions,
          skippedAlreadyPresentedRegions,
          warmExecuted,
          warmDeferred,
          visibleAlpha,
          pixelHash: pixelHash >>> 0,
        });
      } finally {
        full.mockRestore();
        partial.mockRestore();
        clear.mockRestore();
        draw.mockRestore();
        upload.mockRestore();
        renderer.dispose();
      }
    }
    // The fixture's JSON is collected by the profiling command, outside library code.
    console.info(`PRESENTATION_PROFILE ${JSON.stringify(results)}`);
    coreClock.mockRestore();
  });

  it("retains pixels until authoritative completion removes coverage", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      world,
      camera: new Camera(),
    });
    renderer.render();
    raster.clear();
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    renderer.invalidate();
    renderer.render();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    expect(context).not.toBeNull();
    expect(Array.from(context!.getImageData(2, 0, 1, 1).data)).toEqual([
      0, 0, 0, 0,
    ]);
    renderer.dispose();
  });
});
