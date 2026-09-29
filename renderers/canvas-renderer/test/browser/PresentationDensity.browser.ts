import { describe, expect, it, vi } from "vitest";

import { Camera, Raster } from "@reveriejs/core";

import { CanvasRenderer } from "../../index.js";

function createStripedRaster(): Raster {
  const raster = new Raster({ tileSize: 256 });
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const value = x % 16 < 8 ? 0 : 255;
      raster.setPixel({ x, y }, { r: value, g: value, b: value, a: 255 });
    }
  }
  return raster;
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  return canvas;
}

describe("interactive presentation density", () => {
  it.each(["pan", "zoom", "pan and zoom"] as const)(
    "keeps %s within one LOD deficit and restores full pixels on settle",
    (interaction) => {
      const raster = createStripedRaster();
      const camera = new Camera({ zoom: 0.75 });
      const canvas = createCanvas();
      const renderer = new CanvasRenderer({ canvas, raster, camera });
      const clock = vi.spyOn(performance, "now").mockReturnValue(0);
      const target = canvas.getContext("2d");
      const draws: {
        source: number;
        destinationX: number;
        destinationY: number;
      }[] = [];
      const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
      const spy = vi
        .spyOn(CanvasRenderingContext2D.prototype, "drawImage")
        .mockImplementation(function (
          this: CanvasRenderingContext2D,
          ...args: Parameters<CanvasRenderingContext2D["drawImage"]>
        ) {
          if (
            this === target &&
            args.length === 5 &&
            args[0] instanceof HTMLCanvasElement
          ) {
            draws.push({
              source: args[0].width,
              destinationX: args[3],
              destinationY: args[4],
            });
          }
          return originalDraw.apply(this, args);
        });
      try {
        renderer.render({ quality: "full" });
        draws.length = 0;
        if (interaction === "pan") {
          clock.mockReturnValue(16);
          camera.setPan(50, 0);
          renderer.render({ quality: "interactive" });
          while (renderer.hasPendingRender)
            renderer.render({ quality: "interactive" });
          expect(renderer.diagnostics.getSnapshot().coverage.pressure).toBe(
            "high",
          );
          expect(
            renderer.diagnostics.getSnapshot().quality?.outputTileSize,
          ).toBe(128);
          expect(
            draws.some(
              (draw) =>
                draw.source === 128 &&
                (draw.destinationX === 192 || draw.destinationX === 193),
            ),
          ).toBe(true);
          clock.mockReturnValue(32);
          camera.setPan(100, 0);
          renderer.render({ quality: "interactive" });
        } else if (interaction === "zoom") {
          camera.zoomAt({ x: 96, y: 96 }, 0.9);
          renderer.render({ quality: "interactive" });
          camera.zoomAt({ x: 96, y: 96 }, 1.1);
          renderer.render({ quality: "interactive" });
          expect(
            renderer.diagnostics.getSnapshot().quality?.outputTileSize,
          ).toBe(256);
        } else {
          camera.setPan(50, 0);
          renderer.render({ quality: "interactive" });
          camera.zoomAt({ x: 96, y: 96 }, 0.9);
          renderer.render({ quality: "interactive" });
          camera.setPan(100, camera.panY);
          camera.zoomAt({ x: 96, y: 96 }, 1.1);
          renderer.render({ quality: "interactive" });
          expect(
            renderer.diagnostics.getSnapshot().quality?.outputTileSize,
          ).toBe(256);
        }
        expect(draws.length).toBeGreaterThan(0);
        for (const draw of draws) {
          expect(draw.destinationX).toBeLessThanOrEqual(2 * draw.source + 1);
          expect(draw.destinationY).toBeLessThanOrEqual(2 * draw.source + 1);
        }
        while (renderer.hasPendingRender)
          renderer.render({ quality: "interactive" });
        renderer.render({ quality: "full" });
        while (renderer.hasPendingRender) renderer.render({ quality: "full" });
        const referenceCanvas = createCanvas();
        const reference = new CanvasRenderer({
          canvas: referenceCanvas,
          raster,
          camera,
        });
        try {
          reference.render({ quality: "full" });
          while (reference.hasPendingRender)
            reference.render({ quality: "full" });
          expect(
            canvas.getContext("2d")?.getImageData(0, 0, 192, 192).data,
          ).toEqual(
            referenceCanvas.getContext("2d")?.getImageData(0, 0, 192, 192).data,
          );
        } finally {
          reference.dispose();
        }
      } finally {
        clock.mockRestore();
        spy.mockRestore();
        renderer.dispose();
      }
    },
  );
});
