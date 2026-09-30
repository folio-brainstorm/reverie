import { describe, expect, it } from "vitest";

import { Camera, CircleBrush, Raster, View, World } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";

import { CanvasRenderer } from "../../index.js";

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("Expected a browser 2D rendering context.");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function readPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
    pixels[offset + 3] ?? 0,
  ];
}

describe("CanvasRenderer browser minification", () => {
  it.each([1, 0.5, 0.25])(
    "preserves sharper translucent pixels through cached Pan and canonical refinement at zoom %s",
    (zoom) => {
      const world = new World({ tileSize: 16 });
      const bottom = world.getLayer(0);
      const top = world.addLayer();
      top.opacity = 0.6;
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          bottom.raster.setPixel(
            { x, y },
            { r: x * 7, g: y * 7, b: 100, a: 140 },
          );
          if ((x + y) % 3 !== 0) {
            top.raster.setPixel({ x, y }, { r: 200, g: 30, b: 150, a: 90 });
          }
        }
      }
      const canvas = createCanvas(48, 48);
      const camera = new Camera({ zoom, panX: -4, panY: -4 });
      const renderer = new CanvasRenderer({ canvas, world, camera });
      const drain = (quality: "full" | "interactive"): void => {
        for (let batch = 0; batch < 20; batch += 1) {
          renderer.render({ quality });
          if (!renderer.hasPendingRender) return;
        }
        throw new Error("Expected the four-Tile frame to complete.");
      };
      try {
        drain("full");
        drain("interactive");
        for (const panX of [-2, -4, -1, -4]) {
          camera.setPan(panX, -4);
          drain("interactive");
        }
        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        expect(
          renderer.diagnostics.getSnapshot().presentation.uploadedRegionCount,
        ).toBe(0);
        const referenceCanvas = createCanvas(48, 48);
        const reference = new CanvasRenderer({
          canvas: referenceCanvas,
          world,
          camera,
        });
        try {
          do {
            reference.render({ quality: "full" });
          } while (reference.hasPendingRender);
          expect(readPixels(canvas)).toEqual(readPixels(referenceCanvas));
          drain("full");
          do {
            reference.render({ quality: "full" });
          } while (reference.hasPendingRender);
          expect(readPixels(canvas)).toEqual(readPixels(referenceCanvas));
        } finally {
          reference.dispose();
        }
      } finally {
        renderer.dispose();
      }
    },
  );

  it("replaces a low-resolution World preview with canonical pixels when interaction settles", () => {
    const canvas = createCanvas(1, 1);
    const world = new World({ tileSize: 2 });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    top.opacity = 0.7;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
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
    const viewport = { x: 0, y: 0, width: 2, height: 2 };
    const core = new RenderingCore();
    const preview = core.render({
      source: { world },
      context: { scale: 0.5, quality: "interactive" },
      viewport,
    }).regions[0];
    const canonical = core.render({
      source: { world },
      context: { scale: 0.5, quality: "full" },
      viewport,
    }).regions[0];
    const camera = new Camera({ zoom: 0.5 });
    const renderer = new CanvasRenderer({ canvas, world, camera });

    renderer.render({ quality: "interactive" });
    expect(Array.from(readPixels(canvas))).toEqual(
      Array.from(preview?.pixels ?? []),
    );
    renderer.render({ quality: "full" });
    expect(Array.from(readPixels(canvas))).toEqual(
      Array.from(canonical?.pixels ?? []),
    );
    expect(canonical?.pixels).not.toEqual(preview?.pixels);
  });

  it("accepts newer partial pixels and completes a multi-batch replacement", () => {
    const canvas = createCanvas(258, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();

    raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    for (let x = 2; x < 258; x += 2) {
      raster.setPixel({ x, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    }
    renderer.markSourceChanged();
    renderer.render();

    expect(renderer.hasPendingRender).toBe(true);
    expect([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]).toContainEqual(readPixel(readPixels(canvas), canvas.width, 0, 0));
    expect(readPixel(readPixels(canvas), canvas.width, 256, 0)).toEqual([
      0, 0, 0, 0,
    ]);

    renderer.render();

    expect(renderer.hasPendingRender).toBe(false);
    expect(readPixel(readPixels(canvas), canvas.width, 0, 0)).toEqual([
      0, 0, 255, 255,
    ]);
    expect(readPixel(readPixels(canvas), canvas.width, 256, 0)).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("removes pixels omitted by a completed sparse replacement", () => {
    const canvas = createCanvas(4, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera(),
    });
    renderer.render();

    raster.clear();
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    renderer.invalidate();
    expect(readPixel(readPixels(canvas), canvas.width, 2, 0)).toEqual([
      0, 255, 0, 255,
    ]);
    renderer.render();

    expect(readPixel(readPixels(canvas), canvas.width, 0, 0)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(readPixel(readPixels(canvas), canvas.width, 2, 0)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("area-filters a diagonal line instead of preserving nearest-neighbor pixels", () => {
    const canvas = createCanvas(4, 4);
    const raster = new Raster({ tileSize: 16 });
    for (let coordinate = 0; coordinate < 16; coordinate += 1) {
      raster.setPixel(
        { x: coordinate, y: coordinate },
        { r: 0, g: 0, b: 0, a: 255 },
      );
    }

    new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.25 }),
    }).render();

    const alphas = Array.from(readPixels(canvas)).filter(
      (_channel, index) => index % 4 === 3,
    );
    expect(alphas.filter((alpha) => alpha > 0)).toHaveLength(4);
    for (const alpha of alphas.filter((value) => value > 0)) {
      expect(alpha).toBeGreaterThanOrEqual(60);
      expect(alpha).toBeLessThanOrEqual(68);
    }
  });

  it("keeps four opaque Tiles continuous at their shared minified intersection", () => {
    const canvas = createCanvas(7, 7);
    const raster = new Raster({ tileSize: 8 });
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        raster.setPixel({ x, y }, { r: 40, g: 120, b: 220, a: 255 });
      }
    }

    new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.45 }),
    }).render();

    const pixels = readPixels(canvas);
    for (const [x, y] of [
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
    ] as const) {
      const [red, green, blue, alpha] = readPixel(pixels, canvas.width, x, y);
      expect(red).toBeGreaterThanOrEqual(38);
      expect(red).toBeLessThanOrEqual(42);
      expect(green).toBeGreaterThanOrEqual(118);
      expect(green).toBeLessThanOrEqual(122);
      expect(blue).toBeGreaterThanOrEqual(218);
      expect(blue).toBeLessThanOrEqual(222);
      expect(alpha).toBeGreaterThanOrEqual(252);
    }
  });

  it("ignores hidden RGB while filtering transparent Raster edges", () => {
    const canvas = createCanvas(1, 1);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 1, y: 0 }, { r: 0, g: 255, b: 0, a: 0 });

    new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.5 }),
    }).render();

    const [red, green, blue, alpha] = readPixel(readPixels(canvas), 1, 0, 0);
    expect(red).toBeGreaterThanOrEqual(252);
    expect(green).toBeLessThanOrEqual(2);
    expect(blue).toBeLessThanOrEqual(2);
    expect(alpha).toBeGreaterThanOrEqual(62);
    expect(alpha).toBeLessThanOrEqual(66);
  });

  it("matches full-resolution World composition before display minification", () => {
    const canvas = createCanvas(1, 1);
    const world = new World({ tileSize: 2 });
    world
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const top = world.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 128 });

    new CanvasRenderer({
      canvas,
      world,
      camera: new Camera({ zoom: 0.5 }),
    }).render();

    const [red, green, blue, alpha] = readPixel(readPixels(canvas), 1, 0, 0);
    expect(red).toBeGreaterThanOrEqual(125);
    expect(red).toBeLessThanOrEqual(129);
    expect(green).toBeLessThanOrEqual(2);
    expect(blue).toBeGreaterThanOrEqual(126);
    expect(blue).toBeLessThanOrEqual(132);
    expect(alpha).toBeGreaterThanOrEqual(62);
    expect(alpha).toBeLessThanOrEqual(66);
  });

  it("keeps a curved Brush footprint stable during subpixel panning", () => {
    const canvas = createCanvas(8, 8);
    const raster = new Raster({ tileSize: 16 });
    const camera = new Camera({ zoom: 0.5 });
    new CircleBrush({
      size: 12,
      color: { r: 20, g: 20, b: 20, a: 255 },
    }).stamp(raster, { x: 8, y: 8 });
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.render();
    const initialAlpha = Array.from(readPixels(canvas))
      .filter((_channel, index) => index % 4 === 3)
      .reduce((sum, alpha) => sum + alpha, 0);

    camera.setPan(0.125, 0.125);
    renderer.render();
    const pannedAlpha = Array.from(readPixels(canvas))
      .filter((_channel, index) => index % 4 === 3)
      .reduce((sum, alpha) => sum + alpha, 0);

    expect(initialAlpha).toBeGreaterThan(0);
    expect(Math.abs(initialAlpha - pannedAlpha) / initialAlpha).toBeLessThan(
      0.04,
    );
  });
});

describe("CanvasRenderer rotated presentation", () => {
  it.each([1, 1.25, 1.5])(
    "preserves translucent adjacent tiles, clips the World and clears removals at DPR %s",
    (ratio) => {
      const world = new World({
        tileSize: 4,
        bounds: { x: 0, y: 0, width: 8, height: 8 },
      });
      const raster = world.getLayer(0).raster;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          raster.setPixel({ x, y }, { r: 255, g: 0, b: 0, a: 128 });
      const canvas = createCanvas(40 * ratio, 40 * ratio);
      const view = new View({ zoom: 3, panX: -2, panY: -2 });
      const renderer = new CanvasRenderer({ canvas, world, view });
      renderer.resize(canvas.width, canvas.height, ratio);
      const drain = (): void => {
        do {
          renderer.render();
        } while (renderer.hasPendingRender);
      };
      try {
        drain();
        view.rotateAt({ x: 20, y: 20 }, Math.PI / 4);
        drain();
        expect(renderer.diagnostics.getSnapshot().tiles.renderedCount).toBe(0);
        const pixels = readPixels(canvas);
        // Test pixel centers well inside and outside the transformed document.
        // All interior samples include shared tile boundaries and must retain alpha.
        let inside = 0;
        let outside = 0;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            const point = view.screenToWorld({
              x: (x + 0.5) / ratio,
              y: (y + 0.5) / ratio,
            });
            const alpha = readPixel(pixels, canvas.width, x, y)[3];
            if (
              point.x > 0.5 &&
              point.x < 7.5 &&
              point.y > 0.5 &&
              point.y < 7.5
            ) {
              expect(alpha).toBe(128);
              inside++;
            } else if (
              point.x < -0.5 ||
              point.x > 8.5 ||
              point.y < -0.5 ||
              point.y > 8.5
            ) {
              expect(alpha).toBe(0);
              outside++;
            }
          }
        expect(inside).toBeGreaterThan(0);
        expect(outside).toBeGreaterThan(0);
        raster.clear();
        renderer.invalidate();
        drain();
        expect(readPixels(canvas).every((value) => value === 0)).toBe(true);
      } finally {
        renderer.dispose();
      }
    },
  );

  it("reprojects a changed angle with identical coverage and returns to the zero-angle path", () => {
    const raster = new Raster({ tileSize: 4 });
    raster.setPixel({ x: 1, y: 2 }, { r: 0, g: 255, b: 0, a: 255 });
    const canvas = createCanvas(24, 24);
    const view = new View({ zoom: 3, panX: -2, panY: -2 });
    const renderer = new CanvasRenderer({ canvas, raster, view });
    try {
      renderer.render();
      const original = readPixels(canvas);
      view.rotateAt({ x: 12, y: 12 }, Math.PI / 2);
      renderer.render();
      expect(readPixels(canvas)).not.toEqual(original);
      view.rotateAt({ x: 12, y: 12 }, 0);
      renderer.render();
      expect(readPixels(canvas)).toEqual(original);
    } finally {
      renderer.dispose();
    }
  });
});

it("cancels rotated progressive work, retains completed tiles and erases without damaging neighbors", () => {
  const world = new World({
    tileSize: 2,
    bounds: { x: 0, y: 0, width: 24, height: 24 },
  });
  const raster = world.getLayer(0).raster;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++)
      raster.setPixel({ x, y }, { r: x * 10, g: y * 10, b: 50, a: 128 });
  const canvas = createCanvas(24, 24);
  const view = new View();
  const renderer = new CanvasRenderer({ canvas, world, view });
  const referenceCanvas = createCanvas(24, 24);
  const reference = new CanvasRenderer({
    canvas: referenceCanvas,
    world,
    view,
  });
  const drain = (target: CanvasRenderer): void => {
    for (let batch = 0; batch < 10; batch++) {
      target.render();
      if (!target.hasPendingRender) return;
    }
    throw new Error("Expected the frame to finish within ten batches");
  };
  try {
    renderer.render();
    expect(renderer.hasPendingRender).toBe(true);
    view.rotateAt({ x: 12, y: 12 }, Math.PI / 2);
    renderer.render();
    expect(
      renderer.diagnostics.getSnapshot().progressive.cancelledRequestCount,
    ).toBe(1);
    expect(
      renderer.diagnostics.getSnapshot().reuse.presentationHitCount,
    ).toBeGreaterThan(0);
    drain(renderer);
    drain(reference);
    expect(readPixels(canvas)).toEqual(readPixels(referenceCanvas));
    for (let y = 10; y < 12; y++)
      for (let x = 10; x < 12; x++)
        raster.setPixel({ x, y }, { r: 0, g: 0, b: 0, a: 0 });
    renderer.markSourceChanged([{ x: 5, y: 5 }]);
    reference.invalidate();
    drain(renderer);
    drain(reference);
    expect(readPixels(canvas)).toEqual(readPixels(referenceCanvas));
    expect(readPixel(readPixels(canvas), 24, 12, 10)[3]).toBe(0);
    expect(readPixel(readPixels(canvas), 24, 13, 12)[3]).toBe(128);
  } finally {
    renderer.dispose();
    reference.dispose();
  }
});
