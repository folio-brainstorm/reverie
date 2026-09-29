import { describe, expect, it } from "vitest";

import { Camera, Raster } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";

import { CanvasRenderer } from "../../index.js";
import CanvasBackend from "../../src/canvas/CanvasBackend.js";
import CanvasDiagnostics from "../../src/canvas/CanvasDiagnostics.js";

const COLORS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
] as const;

function createScene(edgeAlpha = 255): Raster {
  const raster = new Raster({ tileSize: 8 });
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const color = COLORS[Math.floor(y / 8) * 2 + Math.floor(x / 8)];
      if (color === undefined) {
        throw new Error("Expected a test tile color.");
      }
      raster.setPixel(
        { x, y },
        {
          r: color[0],
          g: color[1],
          b: color[2],
          a: x === 7 || x === 8 || y === 7 || y === 8 ? edgeAlpha : color[3],
        },
      );
    }
  }
  return raster;
}

function sample(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Expected a browser 2D rendering context.");
  }
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

describe("tile seam diagnostic", () => {
  it("probes real Canvas pixels", () => {
    const isFirefox = navigator.userAgent.includes("Firefox");
    for (const [zoom, dpr, pan] of [
      [2, 1, 0],
      [1.5, 1, 0],
      [1.5, 1, 1 / 3],
      [0.45, 1, 0],
      [0.45, 1, 1 / 0.9],
      [1.5, 2, 1 / 6],
      [0.45, 2, 0],
    ] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 40;
      const renderer = new CanvasRenderer({
        canvas,
        raster: createScene(),
        camera: new Camera({ zoom, panX: pan, panY: pan }),
      });
      renderer.resize(40, 40, dpr);
      do {
        renderer.render();
      } while (renderer.hasPendingRender);
      const boundary = (8 - pan) * zoom * dpr;
      const center = Math.floor(boundary);
      const seam = sample(canvas, center, center);
      const outputSize = new RenderingCore().resolveOutputTileSize(8, {
        scale: zoom * dpr,
        quality: "full",
      });
      if (isFirefox && zoom === 0.45) {
        expect(seam[3]).toBeLessThan(255);
        expect(outputSize).toBe(dpr === 1 ? 4 : 8);
        if (dpr === 1 && pan === 0) {
          expect(sample(canvas, 3, 2)).toEqual([120, 134, 0, 194]);
          expect(sample(canvas, 2, 3)).toEqual([120, 0, 134, 194]);
          expect(seam).toEqual([121, 114, 73, 176]);
        }
      } else {
        expect(seam[3]).toBe(255);
      }
      renderer.dispose();
    }
  });

  it("compares source and geometry variants", () => {
    const zoom = 0.45;
    const dpr = 1;
    const pan = 0;
    const camera = new Camera({ zoom, panX: pan, panY: pan });
    const observations = [];
    for (const edgeAlpha of [255, 128, 0]) {
      const raster = createScene(edgeAlpha);
      const core = new RenderingCore();
      const regions = core.render({
        source: { raster },
        context: { scale: zoom * dpr, quality: "full" },
        viewport: { x: 0, y: 0, width: 40 / zoom, height: 40 / zoom },
      }).regions;
      for (const mode of [
        "baseline",
        "smoothOff",
        "paddedCrop",
        "paddedExpanded",
        "overlap",
        "snapped",
      ] as const) {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          throw new Error("Expected a browser 2D rendering context.");
        }
        ctx.imageSmoothingEnabled = mode !== "smoothOff";
        ctx.imageSmoothingQuality = "high";
        for (const region of regions) {
          const size = Math.sqrt(region.pixels.length / 4);
          const isPadded = mode === "paddedCrop" || mode === "paddedExpanded";
          const surface = document.createElement("canvas");
          surface.width = size + (isPadded ? 2 : 0);
          surface.height = surface.width;
          const surfaceCtx = surface.getContext("2d");
          if (surfaceCtx === null) {
            throw new Error("Expected an upload surface context.");
          }
          const data = surfaceCtx.createImageData(
            surface.width,
            surface.height,
          );
          for (let y = 0; y < surface.height; y += 1) {
            for (let x = 0; x < surface.width; x += 1) {
              const sourceX = Math.max(
                0,
                Math.min(size - 1, x - (isPadded ? 1 : 0)),
              );
              const sourceY = Math.max(
                0,
                Math.min(size - 1, y - (isPadded ? 1 : 0)),
              );
              const src = (sourceY * size + sourceX) * 4;
              const dst = (y * surface.width + x) * 4;
              data.data.set(region.pixels.subarray(src, src + 4), dst);
            }
          }
          surfaceCtx.putImageData(data, 0, 0);
          const point = camera.worldToScreen(region.bounds);
          const dx = point.x * dpr;
          const dy = point.y * dpr;
          const dw = region.bounds.width * zoom * dpr;
          const dh = region.bounds.height * zoom * dpr;
          if (mode === "paddedCrop") {
            ctx.drawImage(surface, 1, 1, size, size, dx, dy, dw, dh);
          } else if (mode === "paddedExpanded") {
            const margin = dw / size;
            ctx.drawImage(
              surface,
              dx - margin,
              dy - margin,
              dw + 2 * margin,
              dh + 2 * margin,
            );
          } else if (mode === "overlap") {
            ctx.drawImage(surface, dx, dy, dw + 0.5, dh + 0.5);
          } else if (mode === "snapped") {
            const left = Math.round(dx);
            const top = Math.round(dy);
            ctx.drawImage(
              surface,
              left,
              top,
              Math.round(dx + dw) - left,
              Math.round(dy + dh) - top,
            );
          } else {
            ctx.drawImage(surface, dx, dy, dw, dh);
          }
        }
        observations.push({
          edgeAlpha,
          mode,
          seam: sample(canvas, 3, 3),
          corner: sample(canvas, 4, 4),
          left: sample(canvas, 2, 2),
          right: sample(canvas, 5, 2),
        });
      }
    }
    const findObservation = (edgeAlpha: number, mode: string) => {
      const found = observations.find(
        (item) => item.edgeAlpha === edgeAlpha && item.mode === mode,
      );
      if (found === undefined) {
        throw new Error(`Missing ${edgeAlpha} ${mode} observation.`);
      }
      return found;
    };
    const baseline = findObservation(255, "baseline");
    const smoothOff = findObservation(255, "smoothOff");
    const paddedCrop = findObservation(255, "paddedCrop");
    const paddedExpanded = findObservation(255, "paddedExpanded");
    const overlap = findObservation(255, "overlap");
    const snapped = findObservation(255, "snapped");
    expect(smoothOff.seam).toEqual(baseline.seam);
    expect(paddedCrop.seam).toEqual(baseline.seam);
    expect(snapped.seam).toEqual([255, 0, 0, 255]);
    expect(overlap.seam[3]).toBe(255);
    expect(paddedExpanded.seam[3]).toBe(255);
    if (navigator.userAgent.includes("Firefox")) {
      expect(baseline.seam).toEqual([121, 114, 73, 176]);
      expect(overlap.seam.slice(0, 3)).not.toEqual([255, 0, 0]);
      expect(paddedExpanded.left).not.toEqual([255, 0, 0, 255]);
    } else {
      expect(baseline.seam).toEqual([255, 0, 0, 255]);
    }
    const translucentOverlap = findObservation(128, "overlap");
    const translucentBaseline = findObservation(128, "baseline");
    expect(translucentOverlap.seam[3]).toBeGreaterThan(
      translucentBaseline.seam[3],
    );
    const transparentOverlap = findObservation(0, "overlap");
    const transparentBaseline = findObservation(0, "baseline");
    expect(transparentOverlap.seam[3]).toBeGreaterThan(
      transparentBaseline.seam[3],
    );
  });

  it("exercises complete and progressive CanvasBackend presentation pixels", () => {
    const raster = createScene();
    const core = new RenderingCore();
    const regions = core.render({
      source: { raster },
      context: { scale: 0.45, quality: "full" },
      viewport: { x: 0, y: 0, width: 40 / 0.45, height: 40 / 0.45 },
    }).regions;
    expect(regions).toHaveLength(4);
    expect(regions.every((region) => region.pixels.length === 4 * 4 * 4)).toBe(
      true,
    );
    const alphas: number[] = [];
    for (const isProgressive of [false, true]) {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 40;
      const backend = new CanvasBackend(
        canvas,
        new Camera({ zoom: 0.45 }),
        null,
        new CanvasDiagnostics(core, false),
      );
      if (isProgressive) {
        for (const region of regions) {
          backend.presentRegions([region]);
        }
      } else {
        backend.present(
          {
            identity: {
              requestId: 1,
              viewportKey: "test",
              sourceRevision: "0",
            },
            regions,
          },
          backend.target,
        );
      }
      const seam = sample(canvas, 3, 3);
      alphas.push(seam[3] ?? 0);
      backend.dispose();
    }
    if (navigator.userAgent.includes("Firefox")) {
      expect(alphas).toEqual([176, 130]);
    } else {
      expect(alphas).toEqual([255, 255]);
    }
  });
});
