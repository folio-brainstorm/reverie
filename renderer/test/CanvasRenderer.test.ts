import { describe, expect, it, vi } from "vitest";

import { Camera, Raster, World } from "@reverie/core";
import { deserializeDocument, serializeDocument } from "@reverie/core/document";
import type { Renderer } from "@reverie/core/renderer";

import {
  CanvasRenderer,
  RendererErrorDefinitions,
  RendererError,
  RendererTypeError,
  RendererRangeError,
} from "../index.js";
import type { CanvasRendererConfig } from "../index.js";

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
  it("draws bottom-to-top with layer opacity and isolates same-coordinate tile caches", () => {
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
    expect(alphas).toEqual([1, 0.5]);
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(tileContexts).toHaveLength(2);
    expect(
      vi
        .mocked(tileContexts[0]?.putImageData ?? context.putImageData)
        .mock.calls[0]?.[0].data.slice(0, 4),
    ).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(
      vi
        .mocked(tileContexts[1]?.putImageData ?? context.putImageData)
        .mock.calls[0]?.[0].data.slice(0, 4),
    ).toEqual(new Uint8ClampedArray([0, 0, 255, 255]));
    const firstCanvas = vi.mocked(context.drawImage).mock.calls[0]?.[0];
    const secondCanvas = vi.mocked(context.drawImage).mock.calls[1]?.[0];
    world.moveLayer(top, 0);
    alphas.length = 0;
    vi.mocked(context.drawImage).mockClear();
    renderer.render();
    expect(alphas).toEqual([0.5, 1]);
    expect(
      vi.mocked(context.drawImage).mock.calls.map((call) => call[0]),
    ).toEqual([secondCanvas, firstCanvas]);
    for (const tileContext of tileContexts) {
      expect(tileContext.putImageData).toHaveBeenCalledTimes(1);
    }
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it("does not upload hidden, zero-opacity, or empty layers and reuses uploads on metadata changes", () => {
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
    renderer.render();
    expect(tileContexts).toHaveLength(1);
    expect(tileContexts[0]?.putImageData).toHaveBeenCalledTimes(1);
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
    expect(drawCalls[0]?.slice(1)).toEqual([-1.5, 0, 3, 3]);
    expect(drawCalls[1]?.slice(1)).toEqual([1.5, 0, 3, 3]);
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

  it("invalidates a Tile LOD when any neighbor identity or revision changes", () => {
    const { canvas, tileContexts } = createCanvasFixture(2, 1);
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    raster.setPixel({ x: 2, y: 0 }, { r: 0, g: 255, b: 0, a: 255 });
    const renderer = new CanvasRenderer({
      canvas,
      raster,
      camera: new Camera({ zoom: 0.25 }),
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
    renderer.render();
    const uploadCountAfterChange = tileContexts.reduce(
      (count, context) =>
        count + vi.mocked(context.putImageData).mock.calls.length,
      0,
    );
    expect(uploadCountAfterChange).toBe(4);
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
