import { describe, expect, it, vi } from "vitest";

import { Camera, Raster } from "@reverie/core";
import type { Renderer } from "@reverie/core/renderer";

import {
  CanvasRenderer,
  RendererErrorDefinitions,
  RendererError,
  RendererTypeError,
  RendererRangeError
} from "../index.js";
import type { CanvasRendererConfig } from "../index.js";

function createRenderingContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
      height,
      width,
    })),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
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

describe("CanvasRenderer construction", () => {
  it("is available through the renderer entry point and implements Renderer", () => {
    const { canvas } = createCanvasFixture();
    const raster = new Raster({ tileSize: 2 });
    const camera = new Camera();
    const config: CanvasRendererConfig = { canvas, raster, camera };
    const renderer: Renderer = new CanvasRenderer(config);

    expect(renderer).toBeInstanceOf(CanvasRenderer);
  });

  it("keeps its dependencies fixed after construction", () => {
    const { canvas } = createCanvasFixture();
    const raster = new Raster({ tileSize: 2 });
    const camera = new Camera();
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    expect(renderer.canvas).toBe(canvas);
    expect(renderer.raster).toBe(raster);
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
    const { canvas, context, tileCanvases, tileContexts } =
      createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel(
      { x: 0, y: 0 },
      { r: 255, g: 64, b: 32, a: 255 },
    );
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
      255, 64, 32, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });

  it("renders negative world coordinates in the correct tile", () => {
    const { canvas, context } = createCanvasFixture(4, 4);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel(
      { x: -1, y: -1 },
      { r: 255, g: 0, b: 0, a: 255 },
    );
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
    expect(drawCalls[0]?.slice(1)).toEqual([-1.5, 0, 3, 3]);
    expect(drawCalls[1]?.slice(1)).toEqual([1.5, 0, 3, 3]);
  });

  it("draws only tiles intersecting the visible half-open range", () => {
    const { canvas, context, ownerDocument } = createCanvasFixture(2, 2);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 200, y: 200 }, { r: 0, g: 255, b: 0, a: 255 });
    raster.setPixel(
      { x: -200, y: -200 },
      { r: 0, g: 0, b: 255, a: 255 },
    );
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

    expect({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom }).toEqual({
      panX: -1,
      panY: -2,
      zoom: 2,
    });
    expect(raster.getPixel(pixel)).toEqual(color);
  });
});
