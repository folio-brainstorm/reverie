import { afterEach, describe, it, vi } from "vitest";

import { Camera, World } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";

import { CanvasRenderer } from "../../index.js";
import CanvasBackend from "../../src/canvas/CanvasBackend.js";

const TILE_SIZE = 128;
const WORLD_COLUMNS = 32;
const WORLD_ROWS = 20;
const VIEW_WIDTH = 1024;
const VIEW_HEIGHT = 768;

afterEach(() => vi.restoreAllMocks());

/** Allocates repeatable two-layer content across a large, finite tile grid. */
function createWorld(): World {
  const world = new World({
    tileSize: TILE_SIZE,
    bounds: {
      x: 0,
      y: 0,
      width: WORLD_COLUMNS * TILE_SIZE,
      height: WORLD_ROWS * TILE_SIZE,
    },
  });
  const base = world.getLayer(0).raster;
  const upper = world.addLayer().raster;
  for (let y = 0; y < WORLD_ROWS; y += 1) {
    for (let x = 0; x < WORLD_COLUMNS; x += 1) {
      base.setPixel(
        { x: x * TILE_SIZE + 32, y: y * TILE_SIZE + 32 },
        { r: (x * 7) % 255, g: (y * 11) % 255, b: 100, a: 255 },
      );
      upper.setPixel(
        { x: x * TILE_SIZE + 64, y: y * TILE_SIZE + 64 },
        { r: 220, g: (x * 13) % 255, b: (y * 17) % 255, a: 160 },
      );
    }
  }
  return world;
}

/** Captures independent camera paths without modifying the renderer policy. */
function cameraSteps(
  name: string,
): readonly (readonly [number, number, number])[] {
  if (name === "pan") {
    return Array.from(
      { length: 13 },
      (_, index) => [640 + index * 24, 400 + index * 8, 0.75] as const,
    );
  }
  if (name === "zoom") {
    return Array.from({ length: 13 }, (_, index) => {
      const zoom = 0.5 + index * 0.04;
      return [
        1536 - VIEW_WIDTH / (2 * zoom),
        1024 - VIEW_HEIGHT / (2 * zoom),
        zoom,
      ] as const;
    });
  }
  return Array.from({ length: 13 }, (_, index) => {
    const zoom = 0.5 + index * 0.04;
    return [640 + index * 24, 400 + index * 8, zoom] as const;
  });
}

describe("temporary interaction investigation", () => {
  it("checks whether full-quality cache avoids an interactive zoom upgrade", () => {
    const world = createWorld();
    const canvas = document.createElement("canvas");
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    const camera = new Camera({ zoom: 0.5 });
    camera.setPan(512, 256);
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      world,
      diagnostics: { timings: true },
    });
    const upload = vi.spyOn(CanvasRenderingContext2D.prototype, "putImageData");
    try {
      let warmCalls = 0;
      do {
        renderer.render({ quality: "full", prefetch: false });
        warmCalls += 1;
      } while (renderer.hasPendingRender && warmCalls < 100);
      const before = renderer.diagnostics.getSnapshot();
      const uploadBefore = upload.mock.calls.length;
      camera.setZoom(0.54);
      camera.setPan(
        1536 - VIEW_WIDTH / (2 * 0.54),
        1024 - VIEW_HEIGHT / (2 * 0.54),
      );
      const durations: number[] = [];
      let calls = 0;
      do {
        const startedAt = performance.now();
        renderer.render({ quality: "interactive", prefetch: false });
        durations.push(performance.now() - startedAt);
        calls += 1;
      } while (renderer.hasPendingRender && calls < 100);
      const after = renderer.diagnostics.getSnapshot();
      console.info(
        `FULL_REUSE_INVESTIGATION ${JSON.stringify({
          browser: navigator.userAgent,
          warmCalls,
          calls,
          completed: !renderer.hasPendingRender,
          priorQualitySize: before.quality?.outputTileSize,
          requestedQualitySize: after.quality?.outputTileSize,
          priorVisible: before.regions.visibleCount,
          currentVisible: after.regions.visibleCount,
          presentationHits:
            after.reuse.presentationHitCount -
            before.reuse.presentationHitCount,
          generationHits:
            after.reuse.generationHitCount - before.reuse.generationHitCount,
          coreMisses: after.resultCache.misses - before.resultCache.misses,
          uploads: upload.mock.calls.length - uploadBefore,
          totalMs: durations.reduce((sum, duration) => sum + duration, 0),
          worstMs: Math.max(...durations),
        })}`,
      );
    } finally {
      upload.mockRestore();
      renderer.dispose();
    }
  });

  it("measures a completed zoom quality transition", () => {
    const world = createWorld();
    const canvas = document.createElement("canvas");
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    const camera = new Camera({ zoom: 0.5 });
    camera.setPan(512, 256);
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      world,
      diagnostics: { timings: true },
    });
    const upload = vi.spyOn(CanvasRenderingContext2D.prototype, "putImageData");
    const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    try {
      const results: Record<string, unknown>[] = [];
      for (const zoom of [0.5, 0.54]) {
        camera.setZoom(zoom);
        camera.setPan(
          1536 - VIEW_WIDTH / (2 * zoom),
          1024 - VIEW_HEIGHT / (2 * zoom),
        );
        const start = renderer.diagnostics.getSnapshot();
        const uploadStart = upload.mock.calls.length;
        const drawStart = draw.mock.calls.length;
        const durations: number[] = [];
        let calls = 0;
        let firstFrameAlphaPixels = 0;
        let firstFrameDraws = 0;
        do {
          const startedAt = performance.now();
          renderer.render({ quality: "interactive", prefetch: false });
          durations.push(performance.now() - startedAt);
          calls += 1;
          if (calls === 1) {
            firstFrameDraws = draw.mock.calls.length - drawStart;
            const pixels = canvas
              .getContext("2d")!
              .getImageData(0, 0, VIEW_WIDTH, VIEW_HEIGHT).data;
            for (let index = 3; index < pixels.length; index += 4) {
              if (pixels[index] > 0) firstFrameAlphaPixels += 1;
            }
          }
        } while (renderer.hasPendingRender && calls < 100);
        const end = renderer.diagnostics.getSnapshot();
        let settledAlphaPixels = 0;
        const settledPixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, VIEW_WIDTH, VIEW_HEIGHT).data;
        for (let index = 3; index < settledPixels.length; index += 4) {
          if (settledPixels[index] > 0) settledAlphaPixels += 1;
        }
        results.push({
          zoom,
          calls,
          completed: !renderer.hasPendingRender,
          outputSize: end.quality?.outputTileSize,
          visible: end.regions.visibleCount,
          totalMs: durations.reduce((sum, duration) => sum + duration, 0),
          worstMs: Math.max(...durations),
          generatedRegions: end.resultCache.misses - start.resultCache.misses,
          coreHits: end.resultCache.hits - start.resultCache.hits,
          reused: end.reuse.generationHitCount - start.reuse.generationHitCount,
          uploads: upload.mock.calls.length - uploadStart,
          firstFrameDraws,
          firstFrameAlphaPixels,
          settledAlphaPixels,
          cancelled:
            end.progressive.cancelledRequestCount -
            start.progressive.cancelledRequestCount,
        });
      }
      console.info(
        `ZOOM_SETTLE_INVESTIGATION ${JSON.stringify({ browser: navigator.userAgent, results })}`,
      );
    } finally {
      upload.mockRestore();
      draw.mockRestore();
      renderer.dispose();
    }
  });

  it("measures settled DPR 2 panning", () => {
    const world = createWorld();
    const canvas = document.createElement("canvas");
    const camera = new Camera({ zoom: 0.75 });
    camera.setPan(640, 400);
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      world,
      diagnostics: { timings: true },
    });
    renderer.resize(VIEW_WIDTH * 2, VIEW_HEIGHT * 2, 2);
    const upload = vi.spyOn(CanvasRenderingContext2D.prototype, "putImageData");
    const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    try {
      let warmCalls = 0;
      do {
        renderer.render({ quality: "interactive", prefetch: false });
        warmCalls += 1;
      } while (renderer.hasPendingRender && warmCalls < 100);
      const records: Record<string, number>[] = [];
      let prior = renderer.diagnostics.getSnapshot();
      let priorUploads = upload.mock.calls.length;
      let priorDraws = draw.mock.calls.length;
      for (let step = 1; step <= 12; step += 1) {
        camera.setPan(640 + step * 24, 400 + step * 8);
        const startedAt = performance.now();
        renderer.render({ quality: "interactive", prefetch: false });
        const durationMs = performance.now() - startedAt;
        const current = renderer.diagnostics.getSnapshot();
        records.push({
          step,
          outputSize: current.quality?.outputTileSize ?? 0,
          durationMs,
          coreMs: current.rendering?.coreDurationMs.current ?? 0,
          canvasMs: current.presentation.presentationDurationMs?.current ?? 0,
          generatedBytes: current.tiles.generatedPixelBytes,
          coreHits: current.resultCache.hits - prior.resultCache.hits,
          coreMisses: current.resultCache.misses - prior.resultCache.misses,
          reused:
            current.reuse.generationHitCount - prior.reuse.generationHitCount,
          cancelled:
            current.progressive.cancelledRequestCount -
            prior.progressive.cancelledRequestCount,
          uploads: upload.mock.calls.length - priorUploads,
          draws: draw.mock.calls.length - priorDraws,
        });
        prior = current;
        priorUploads = upload.mock.calls.length;
        priorDraws = draw.mock.calls.length;
      }
      console.info(
        `DPR2_PAN_INVESTIGATION ${JSON.stringify({ browser: navigator.userAgent, warmCalls, records })}`,
      );
    } finally {
      upload.mockRestore();
      draw.mockRestore();
      renderer.dispose();
    }
  });

  it("measures only newly exposed coverage after settled pan", () => {
    const world = createWorld();
    const canvas = document.createElement("canvas");
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    const camera = new Camera({ zoom: 0.75 });
    camera.setPan(640, 400);
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      world,
      diagnostics: { timings: true },
    });
    const coreRender = vi.spyOn(RenderingCore.prototype, "render");
    const upload = vi.spyOn(CanvasRenderingContext2D.prototype, "putImageData");
    const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    try {
      let warmCalls = 0;
      do {
        renderer.render({ quality: "interactive", prefetch: false });
        warmCalls += 1;
      } while (renderer.hasPendingRender && warmCalls < 100);
      const before = renderer.diagnostics.getSnapshot();
      const uploadBefore = upload.mock.calls.length;
      const drawBefore = draw.mock.calls.length;
      const coreRenderBefore = coreRender.mock.calls.length;
      camera.setPan(768, 400);
      const durations: number[] = [];
      let calls = 0;
      do {
        const startedAt = performance.now();
        renderer.render({ quality: "interactive", prefetch: false });
        durations.push(performance.now() - startedAt);
        calls += 1;
      } while (renderer.hasPendingRender && calls < 100);
      const after = renderer.diagnostics.getSnapshot();
      const request = coreRender.mock.calls.at(-1)?.[0];
      console.info(
        `EDGE_PAN_INVESTIGATION ${JSON.stringify({
          browser: navigator.userAgent,
          warmCalls,
          calls,
          completed: !renderer.hasPendingRender,
          priorNonempty: before.regions.visibleCount,
          afterNonempty: after.regions.visibleCount,
          geometricBefore: 99,
          geometricRetained: 90,
          geometricNew: 9,
          geometricLeaving: 9,
          outputSize: after.quality?.outputTileSize,
          skippedInitial:
            coreRender.mock.calls[coreRenderBefore]?.[0].skipTiles?.length,
          generated: after.resultCache.misses - before.resultCache.misses,
          coreHits: after.resultCache.hits - before.resultCache.hits,
          uploads: upload.mock.calls.length - uploadBefore,
          draws: draw.mock.calls.length - drawBefore,
          totalMs: durations.reduce((sum, duration) => sum + duration, 0),
          worstMs: Math.max(...durations),
          lastSkipTiles: request?.skipTiles?.length,
        })}`,
      );
    } finally {
      coreRender.mockRestore();
      upload.mockRestore();
      draw.mockRestore();
      renderer.dispose();
    }
  });

  it("classifies a single pan after coverage has settled", () => {
    const world = createWorld();
    for (const initialQuality of ["interactive", "full"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = VIEW_WIDTH;
      canvas.height = VIEW_HEIGHT;
      const camera = new Camera({ zoom: 0.75 });
      camera.setPan(640, 400);
      const renderer = new CanvasRenderer({
        canvas,
        camera,
        world,
        diagnostics: { timings: true },
      });
      const coreRender = vi.spyOn(RenderingCore.prototype, "render");
      const upload = vi.spyOn(
        CanvasRenderingContext2D.prototype,
        "putImageData",
      );
      const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
      try {
        let warmCalls = 0;
        const warmDurations: number[] = [];
        const warmStart = renderer.diagnostics.getSnapshot();
        do {
          const warmStartedAt = performance.now();
          renderer.render({ quality: initialQuality, prefetch: false });
          warmDurations.push(performance.now() - warmStartedAt);
          warmCalls += 1;
        } while (renderer.hasPendingRender && warmCalls < 100);
        const warmCompleted = !renderer.hasPendingRender;
        const before = renderer.diagnostics.getSnapshot();
        const uploadBefore = upload.mock.calls.length;
        const drawBefore = draw.mock.calls.length;
        camera.setPan(664, 408);
        const startedAt = performance.now();
        renderer.render({ quality: "interactive", prefetch: false });
        const elapsedMs = performance.now() - startedAt;
        const after = renderer.diagnostics.getSnapshot();
        const request = coreRender.mock.calls.at(-1)?.[0];
        const firstUploads = upload.mock.calls.length - uploadBefore;
        const firstDraws = draw.mock.calls.length - drawBefore;
        let completionCalls = 1;
        if (initialQuality === "full") {
          while (renderer.hasPendingRender && completionCalls < 100) {
            renderer.render({ quality: "interactive", prefetch: false });
            completionCalls += 1;
          }
        }
        const completedPan = renderer.diagnostics.getSnapshot();
        console.info(
          `PURE_PAN_INVESTIGATION ${JSON.stringify({
            browser: navigator.userAgent,
            initialQuality,
            warmCalls,
            warmCompleted,
            warmTotalMs: warmDurations.reduce(
              (sum, duration) => sum + duration,
              0,
            ),
            warmWorstMs: Math.max(...warmDurations),
            warmGeneratedRegions:
              before.resultCache.misses - warmStart.resultCache.misses,
            warmUploads: uploadBefore,
            warmContinuations:
              before.progressive.continuationCount -
              warmStart.progressive.continuationCount,
            beforeVisible: before.regions.visibleCount,
            afterVisible: after.zones.visibleCount,
            previousVisibleTiles: 99,
            retainedVisibleTiles: 99,
            newlyExposedTiles: 0,
            leavingTiles: 0,
            requestedOutputSize: after.quality?.outputTileSize,
            priorOutputSize: before.quality?.outputTileSize,
            skipTiles: request?.skipTiles?.length,
            coreRequests:
              after.progressive.requestCount - before.progressive.requestCount,
            coreHits: after.resultCache.hits - before.resultCache.hits,
            coreMisses: after.resultCache.misses - before.resultCache.misses,
            presentationReused:
              after.reuse.presentationHitCount -
              before.reuse.presentationHitCount,
            generationReused:
              after.reuse.generationHitCount - before.reuse.generationHitCount,
            resolved: after.coverage.missingVisibleCount,
            generatedBytes: after.tiles.generatedPixelBytes,
            uploads: firstUploads,
            draws: firstDraws,
            completionCalls,
            completionCoreMisses:
              completedPan.resultCache.misses - before.resultCache.misses,
            completionUploads: upload.mock.calls.length - uploadBefore,
            elapsedMs,
            coreMs: after.rendering?.coreDurationMs.current,
            canvasMs: after.presentation.presentationDurationMs?.current,
          })}`,
        );
      } finally {
        coreRender.mockRestore();
        upload.mockRestore();
        draw.mockRestore();
        renderer.dispose();
      }
    }
  });

  it("records deterministic multi-tile paths", () => {
    const world = createWorld();
    for (const path of ["pan", "zoom", "panZoom"]) {
      const canvas = document.createElement("canvas");
      canvas.width = VIEW_WIDTH;
      canvas.height = VIEW_HEIGHT;
      const camera = new Camera({ zoom: 0.75 });
      const renderer = new CanvasRenderer({
        canvas,
        camera,
        world,
        diagnostics: { timings: true },
      });
      const coreRender = vi.spyOn(RenderingCore.prototype, "render");
      const coreContinue = vi.spyOn(RenderingCore.prototype, "continueRender");
      const fullPresent = vi.spyOn(CanvasBackend.prototype, "present");
      const partialPresent = vi.spyOn(
        CanvasBackend.prototype,
        "presentRegions",
      );
      const originalPutImageData =
        CanvasRenderingContext2D.prototype.putImageData;
      let putImageDataDurationMs = 0;
      const upload = vi
        .spyOn(CanvasRenderingContext2D.prototype, "putImageData")
        .mockImplementation(function (imageData, dx, dy) {
          const startedAt = performance.now();
          originalPutImageData.call(this, imageData, dx, dy);
          putImageDataDurationMs += performance.now() - startedAt;
        });
      const draw = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
      const createElement = vi.spyOn(Document.prototype, "createElement");
      const originalClear = CanvasRenderingContext2D.prototype.clearRect;
      const originalClip = CanvasRenderingContext2D.prototype.clip;
      const originalCreateImageData =
        CanvasRenderingContext2D.prototype.createImageData;
      let clearDurationMs = 0;
      let clipDurationMs = 0;
      let createImageDataDurationMs = 0;
      const clear = vi
        .spyOn(CanvasRenderingContext2D.prototype, "clearRect")
        .mockImplementation(function (x, y, width, height) {
          const startedAt = performance.now();
          originalClear.call(this, x, y, width, height);
          clearDurationMs += performance.now() - startedAt;
        });
      const clip = vi
        .spyOn(CanvasRenderingContext2D.prototype, "clip")
        .mockImplementation(function () {
          const startedAt = performance.now();
          originalClip.call(this);
          clipDurationMs += performance.now() - startedAt;
        });
      const createImageData = vi
        .spyOn(CanvasRenderingContext2D.prototype, "createImageData")
        .mockImplementation(function (width, height) {
          const startedAt = performance.now();
          const result = originalCreateImageData.call(this, width, height);
          createImageDataDurationMs += performance.now() - startedAt;
          return result;
        });
      const records: Record<string, unknown>[] = [];
      let prior = renderer.diagnostics.getSnapshot();
      let previousVisible = new Set<string>();
      const resolvedRegionKeys = new Set<string>();
      try {
        const steps = cameraSteps(path);
        for (let step = 0; step < steps.length + 5; step += 1) {
          const [panX, panY, zoom] = steps[Math.min(step, steps.length - 1)]!;
          camera.setPan(panX, panY);
          camera.setZoom(zoom);
          const quality = step < steps.length ? "interactive" : "full";
          const previousCoreRenderCalls = coreRender.mock.calls.length;
          const previousCoreContinueCalls = coreContinue.mock.calls.length;
          const start = performance.now();
          renderer.render({ quality, prefetch: false });
          const durationMs = performance.now() - start;
          const current = renderer.diagnostics.getSnapshot();
          const viewport = camera.visibleWorldRect({
            width: VIEW_WIDTH,
            height: VIEW_HEIGHT,
          });
          const visible = new Set<string>();
          for (
            let y = Math.floor(viewport.y / TILE_SIZE);
            y < Math.ceil((viewport.y + viewport.height) / TILE_SIZE);
            y += 1
          ) {
            for (
              let x = Math.floor(viewport.x / TILE_SIZE);
              x < Math.ceil((viewport.x + viewport.width) / TILE_SIZE);
              x += 1
            ) {
              if (x >= 0 && y >= 0 && x < WORLD_COLUMNS && y < WORLD_ROWS)
                visible.add(`${x}:${y}`);
            }
          }
          const returned =
            coreRender.mock.calls.length > previousCoreRenderCalls
              ? coreRender.mock.results.at(-1)?.value
              : coreContinue.mock.calls.length > previousCoreContinueCalls
                ? coreContinue.mock.results.at(-1)?.value
                : undefined;
          const resultKeys = (returned?.regions ?? []).map(
            (region: { bounds: { x: number; y: number } }) =>
              `${current.quality?.outputTileSize}:${region.bounds.x}:${region.bounds.y}`,
          );
          const repeatedRegionCount = resultKeys.filter((key: string) =>
            resolvedRegionKeys.has(key),
          ).length;
          for (const key of resultKeys) resolvedRegionKeys.add(key);
          const lastCoreCall = coreRender.mock.calls.at(-1);
          const newVisible = [...visible].filter(
            (key) => !previousVisible.has(key),
          ).length;
          const retainedVisible = [...visible].filter((key) =>
            previousVisible.has(key),
          ).length;
          const surfacesCreated = createElement.mock.calls.filter(
            ([tag]) => tag === "canvas",
          ).length;
          records.push({
            step,
            quality,
            panX,
            panY,
            zoom,
            dpr: 1,
            visible: visible.size,
            retainedVisible,
            newlyVisible: newVisible,
            outputSize: current.quality?.outputTileSize,
            durationMs: Math.round(durationMs * 10) / 10,
            coreMs: current.rendering?.coreDurationMs.current,
            compositionMs: current.rendering?.compositionDurationMs.current,
            lodMs: current.rendering?.lodDurationMs.current,
            canvasMs: current.presentation.presentationDurationMs?.current,
            uploadMs: current.presentation.uploadDurationMs?.current,
            drawMs: current.presentation.drawDurationMs?.current,
            clearMs: clearDurationMs,
            clipMs: clipDurationMs,
            createImageDataMs: createImageDataDurationMs,
            putImageDataMs: putImageDataDurationMs,
            requests:
              current.progressive.requestCount - prior.progressive.requestCount,
            completed:
              current.progressive.completedRequestCount -
              prior.progressive.completedRequestCount,
            cancelled:
              current.progressive.cancelledRequestCount -
              prior.progressive.cancelledRequestCount,
            continuations:
              current.progressive.continuationCount -
              prior.progressive.continuationCount,
            coreHits: current.resultCache.hits - prior.resultCache.hits,
            coreMisses: current.resultCache.misses - prior.resultCache.misses,
            presentationHits:
              current.reuse.presentationHitCount -
              prior.reuse.presentationHitCount,
            reusable:
              current.reuse.generationHitCount - prior.reuse.generationHitCount,
            resolved: current.coverage.missingVisibleCount,
            provisional:
              current.reuse.provisionalRegionCount -
              prior.reuse.provisionalRegionCount,
            pending: current.regions.pendingCount,
            generatedBytes: current.tiles.generatedPixelBytes,
            returnedBytes: current.tiles.outputPixelBytes,
            uploads: current.presentation.uploadedRegionCount,
            draws: current.presentation.drawnRegionCount,
            uploadCalls: upload.mock.calls.length,
            drawCalls: draw.mock.calls.length,
            clearCalls: clear.mock.calls.length,
            clipCalls: clip.mock.calls.length,
            surfacesCreated,
            fullPresentCalls: fullPresent.mock.calls.length,
            partialPresentCalls: partialPresent.mock.calls.length,
            coreRenderCalls: coreRender.mock.calls.length,
            coreContinueCalls: coreContinue.mock.calls.length,
            requestId: lastCoreCall?.[0].identity?.requestId,
            returnedRegions: returned?.regions?.length,
            repeatedRegionCount,
            hasContinuation: returned?.continuation !== undefined,
          });
          previousVisible = visible;
          prior = current;
        }
        console.info(
          `INTERACTION_INVESTIGATION ${JSON.stringify({ browser: navigator.userAgent, path, tileCount: WORLD_COLUMNS * WORLD_ROWS, viewport: [VIEW_WIDTH, VIEW_HEIGHT], records })}`,
        );
      } finally {
        coreRender.mockRestore();
        coreContinue.mockRestore();
        fullPresent.mockRestore();
        partialPresent.mockRestore();
        upload.mockRestore();
        draw.mockRestore();
        clear.mockRestore();
        clip.mockRestore();
        createImageData.mockRestore();
        createElement.mockRestore();
        renderer.dispose();
      }
    }
  });
});
