import { afterEach, describe, expect, it, vi } from "vitest";

import { CircleBrush, deriveStrokeSeed, Stroke, World } from "@reverie/core";
import type { StampCommand } from "@reverie/core";
import {
  ExportRenderer,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "@reverie/exporter";

import {
  CanvasDrawingSession,
  ReverieCanvas,
  WebError,
  WebErrorDefinitions,
  WebRangeError,
} from "../index.js";
import type { FrameCallback, ReverieCanvasConfig } from "../index.js";

import {
  DownloadTestRuntime,
  flushScheduledTimers,
} from "./DownloadTestRuntime.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReverieCanvas construction", () => {
  it("exports its config and creates a fixed World with one active layer", () => {
    const runtime = createCanvasRuntime();
    const config: ReverieCanvasConfig = {
      canvas: runtime.canvas,
      width: 1920,
      height: 1080,
      tileSize: 128,
    };
    const reverie = new ReverieCanvas(config);

    expect(reverie.world.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    expect(reverie.activeLayer.bounds).toEqual(reverie.world.bounds);
    expect(reverie.activeLayer.raster.tileSize).toBe(128);
    expect(reverie.renderer.raster).toBe(reverie.activeLayer.raster);
    expect(reverie.session.raster).toBe(reverie.activeLayer.raster);
    expect(runtime.canvas.listenerCount).toBeGreaterThan(0);
    expect(runtime.observer?.observedTarget).toBe(runtime.canvas);

    reverie.dispose();
  });

  it("creates an infinite World and a usable default CircleBrush", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });

    expect(reverie.world.bounds).toBeNull();
    expect(reverie.brush).toBeInstanceOf(CircleBrush);
    expect(reverie.brush.size).toBe(1);

    reverie.dispose();
  });

  it.each([
    { width: 16 },
    { height: 16 },
    { width: 0, height: 16 },
    { width: 16, height: -1 },
    { width: 1.5, height: 16 },
    { width: 16, height: Number.POSITIVE_INFINITY },
  ])(
    "rejects invalid dimension configuration $width x $height",
    (dimensions) => {
      const runtime = createCanvasRuntime();
      const createReverie = () =>
        new ReverieCanvas({ canvas: runtime.canvas, ...dimensions });

      expect(createReverie).toThrow(WebRangeError);
      expect(createReverie).toThrow(
        `[${WebErrorDefinitions.INVALID_REVERIE_CANVAS_DIMENSIONS.code}]`,
      );
    },
  );
});

describe("ReverieCanvas drawing and lifecycle", () => {
  it("responds to pointer input immediately and clips painting to fixed bounds", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 16,
      height: 16,
    });

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });
    runtime.runNextFrame();

    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 255,
    });

    runtime.canvas.dispatchPointer("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 2,
    });
    reverie.dispose();
  });

  it("delegates Brush replacement, clear, and explicit rendering", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const brush = new CircleBrush({
      size: 2,
      color: { r: 255, g: 0, b: 0, a: 255 },
    });

    reverie.setBrush(brush);
    reverie.activeLayer.raster.setPixel(
      { x: 0, y: 0 },
      { r: 255, g: 0, b: 0, a: 255 },
    );
    reverie.render();
    reverie.clear();

    expect(reverie.brush).toBe(brush);
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    reverie.dispose();
  });

  it("releases runtime resources and rejects mutations after disposal", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const brush = reverie.brush;

    reverie.dispose();
    reverie.dispose();

    expect(runtime.canvas.listenerCount).toBe(0);
    expect(runtime.observer?.hasDisconnected).toBe(true);
    expect(() => reverie.setBrush(brush)).toThrow(WebError);
    expect(() => reverie.clear()).toThrow(
      `[${WebErrorDefinitions.REVERIE_CANVAS_DISPOSED.code}]`,
    );
    expect(() => reverie.render()).toThrow(
      `[${WebErrorDefinitions.REVERIE_CANVAS_DISPOSED.code}]`,
    );
  });
});

describe("CanvasDrawingSession pointer input mapping", () => {
  it("preserves pen pressure and tilt", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const addSample = vi.spyOn(Stroke.prototype, "addSample");

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
      pointerType: "pen",
      pressure: 0.35,
      tiltX: -20,
      tiltY: 10,
    });

    expect(addSample).toHaveBeenCalledTimes(1);
    expect(addSample).toHaveBeenCalledWith(
      expect.objectContaining({ pressure: 0.35, tiltX: -20, tiltY: 10 }),
    );
    reverie.dispose();
  });

  it("forwards pen input through per-stamp brush dynamics", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      brush: new CircleBrush({
        size: 1,
        color: { r: 0, g: 255, b: 0, a: 255 },
        dynamics: { opacity: { pressure: { min: 0 } } },
      }),
    });

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
      pointerType: "pen",
      pressure: 0.25,
    });
    runtime.runNextFrame();

    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 0,
      g: 255,
      b: 0,
      a: 64,
    });
    reverie.dispose();
  });

  it("ignores mouse pressure and resolves the Core default", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const addSample = vi.spyOn(Stroke.prototype, "addSample");

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
      pointerType: "mouse",
      pressure: 0.5,
    });

    expect(addSample).toHaveBeenCalledWith(
      expect.objectContaining({ pressure: 1 }),
    );
    reverie.dispose();
  });

  it("ignores touch pressure and resolves the Core default", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const addSample = vi.spyOn(Stroke.prototype, "addSample");

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
      pointerType: "touch",
      pressure: 0.8,
    });

    expect(addSample).toHaveBeenCalledWith(
      expect.objectContaining({ pressure: 1 }),
    );
    reverie.dispose();
  });

  it.each([0, 1.5, Number.NaN])(
    "falls back to the Core default for unreliable pen pressure %s",
    (pressure) => {
      const runtime = createCanvasRuntime();
      const reverie = new ReverieCanvas({ canvas: runtime.canvas });
      const addSample = vi.spyOn(Stroke.prototype, "addSample");

      runtime.canvas.dispatchPointer("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 0.5,
        clientY: 0.5,
        timeStamp: 1,
        pointerType: "pen",
        pressure,
      });

      expect(addSample).toHaveBeenCalledWith(
        expect.objectContaining({ pressure: 1 }),
      );
      reverie.dispose();
    },
  );

  it("falls back to the Core default for non-finite tilt", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const addSample = vi.spyOn(Stroke.prototype, "addSample");

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
      pointerType: "pen",
      pressure: 0.5,
      tiltX: Number.NaN,
      tiltY: Number.POSITIVE_INFINITY,
    });

    expect(addSample).toHaveBeenCalledWith(
      expect.objectContaining({ tiltX: 0, tiltY: 0 }),
    );
    reverie.dispose();
  });

  it("keeps individual input values for each coalesced event", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const addSample = vi.spyOn(Stroke.prototype, "addSample");

    runtime.canvas.dispatchPointer(
      "pointerdown",
      {
        button: 0,
        pointerId: 1,
        clientX: 0.5,
        clientY: 0.5,
        timeStamp: 1,
        pointerType: "pen",
        pressure: 0.1,
      },
      [
        {
          button: 0,
          pointerId: 1,
          clientX: 1.5,
          clientY: 0.5,
          timeStamp: 2,
          pointerType: "pen",
          pressure: 0.4,
          tiltX: -10,
        },
        {
          button: 0,
          pointerId: 1,
          clientX: 2.5,
          clientY: 0.5,
          timeStamp: 3,
          pointerType: "pen",
          pressure: 0.9,
          tiltX: 20,
        },
      ],
    );

    expect(addSample).toHaveBeenCalledTimes(2);
    expect(addSample).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pressure: 0.4, tiltX: -10, timestamp: 2 }),
    );
    expect(addSample).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pressure: 0.9, tiltX: 20, timestamp: 3 }),
    );
    reverie.dispose();
  });
});

describe("CanvasDrawingSession deterministic stroke seeds", () => {
  it("derives different seeds for successive strokes before scheduled execution", () => {
    const runtime = createCanvasRuntime();
    const brush = new CircleBrush({
      size: 4,
      seed: 0xffffffff,
      color: { r: 0, g: 255, b: 0, a: 255 },
      jitter: { size: 0.2 },
    });
    const paint = vi.spyOn(brush, "stamp");
    const reverie = new ReverieCanvas({ canvas: runtime.canvas, brush });
    for (let index = 0; index < 2; index += 1) {
      const pointer = {
        button: 0,
        pointerId: index + 1,
        clientX: 4.5,
        clientY: 4.5,
        timeStamp: 1,
      };
      runtime.canvas.dispatchPointer("pointerdown", pointer);
      runtime.canvas.dispatchPointer("pointerup", pointer);
    }
    expect(reverie.session.nextStrokeSequence).toBe(2);
    expect(paint).not.toHaveBeenCalled();
    runtime.runNextFrame();
    expect(paint.mock.calls.map((call) => call[2]?.strokeSeed)).toEqual([
      deriveStrokeSeed(brush.seed, 0),
      deriveStrokeSeed(brush.seed, 1),
    ]);
    expect(paint.mock.calls.map((call) => call[2]?.stampIndex)).toEqual([0, 0]);
    reverie.dispose();
  });

  it.each([
    [0, 1],
    [7, 8],
    [0x80000000, 0x80000001],
    [0xffffffff, 0],
  ])(
    "restores facade sequence %s and advances it to %s",
    (strokeSequence, nextSequence) => {
      const runtime = createCanvasRuntime();
      const config: ReverieCanvasConfig = {
        canvas: runtime.canvas,
        strokeSequence,
      };
      const reverie = new ReverieCanvas(config);
      const paint = vi.spyOn(reverie.brush, "stamp");
      expect(reverie.session.nextStrokeSequence).toBe(strokeSequence);
      const pointer = {
        button: 0,
        pointerId: 1,
        clientX: 0.5,
        clientY: 0.5,
        timeStamp: 1,
      };
      runtime.canvas.dispatchPointer("pointerdown", pointer);
      expect(reverie.session.nextStrokeSequence).toBe(nextSequence);
      runtime.canvas.dispatchPointer("pointerup", pointer);
      runtime.runNextFrame();
      expect(paint.mock.calls[0]?.[2]?.strokeSeed).toBe(
        deriveStrokeSeed(0, strokeSequence),
      );
      reverie.dispose();
    },
  );

  it("does not consume a sequence for ignored pointer-down events", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const pointer = {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    };
    runtime.canvas.dispatchPointer("pointerdown", { ...pointer, button: 1 });
    expect(reverie.session.nextStrokeSequence).toBe(0);
    runtime.canvas.dispatchPointer("pointerdown", pointer);
    runtime.canvas.dispatchPointer("pointerdown", { ...pointer, pointerId: 2 });
    expect(reverie.session.nextStrokeSequence).toBe(1);
    reverie.dispose();
  });

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "rejects invalid initial stroke sequence %s",
    (strokeSequence) => {
      const runtime = createCanvasRuntime();
      const reverie = new ReverieCanvas({ canvas: runtime.canvas });
      expect(
        () =>
          new CanvasDrawingSession({
            canvas: runtime.canvas,
            raster: reverie.activeLayer.raster,
            camera: reverie.camera,
            renderer: reverie.renderer,
            brush: reverie.brush,
            strokeSequence,
          }),
      ).toThrow(`[${WebErrorDefinitions.INVALID_STROKE_SEQUENCE.code}]`);
      const config: ReverieCanvasConfig = {
        canvas: runtime.canvas,
        strokeSequence,
      };
      expect(() => new ReverieCanvas(config)).toThrow(
        `[${WebErrorDefinitions.INVALID_STROKE_SEQUENCE.code}]`,
      );
      reverie.dispose();
    },
  );

  it("keeps jitter and scatter pixels identical for equivalent individually delivered and coalesced input", () => {
    const paint = (
      shouldCoalesce: boolean,
    ): { pixels: Uint8ClampedArray; commands: StampCommand[] } => {
      const runtime = createCanvasRuntime();
      const brush = new CircleBrush({
        size: 4,
        opacity: 0.6,
        seed: 0x80000000,
        color: { r: 0, g: 255, b: 0, a: 255 },
        jitter: { size: 0.2, opacity: 0.2, rotation: 0.2 },
        scatter: { along: 0.25, across: 0.15 },
      });
      const originalStamp = brush.stamp.bind(brush);
      const commands: StampCommand[] = [];
      vi.spyOn(brush, "stamp").mockImplementation((raster, position, input) => {
        if (input !== undefined) {
          commands.push({ ...input, position: { ...input.position } });
        }
        originalStamp(raster, position, input);
      });
      const reverie = new ReverieCanvas({
        canvas: runtime.canvas,
        brush,
      });
      const first = {
        button: 0,
        pointerId: 1,
        clientX: 2.5,
        clientY: 4.5,
        timeStamp: 1,
      };
      const middle = { ...first, clientX: 6.5, timeStamp: 5 };
      const last = { ...first, clientX: 10.5, timeStamp: 9 };
      runtime.canvas.dispatchPointer("pointerdown", first);
      if (shouldCoalesce) {
        runtime.canvas.dispatchPointer("pointermove", last, [middle, last]);
      } else {
        runtime.runNextFrame();
        runtime.canvas.dispatchPointer("pointermove", middle);
        runtime.runNextFrame();
        runtime.canvas.dispatchPointer("pointermove", last);
      }
      runtime.canvas.dispatchPointer("pointerup", last);
      runtime.runNextFrame();
      const pixels = new ExportRenderer({
        raster: reverie.activeLayer.raster,
      }).render({ x: 0, y: 0, width: 16, height: 16 }).pixels;
      reverie.dispose();
      return { pixels, commands };
    };
    const separate = paint(false);
    expect(separate.pixels.some((byte) => byte > 0)).toBe(true);
    const coalesced = paint(true);
    expect(coalesced.commands).toEqual(separate.commands);
    expect(coalesced.pixels).toEqual(separate.pixels);
  });
});

describe("ReverieCanvas export and download", () => {
  it("downloads the whole fixed World as PNG by default", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 1920,
      height: 1080,
    });
    const renderSpy = vi.spyOn(ExportRenderer.prototype, "render");
    const encodeSpy = vi.spyOn(PNGEncoder.prototype, "encode");

    await reverie.download({ format: "png" });
    await flushScheduledTimers();

    expect(renderSpy).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    expect(encodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920, height: 1080 }),
      {},
    );
    expect(runtime.downloads.blobs[0]?.type).toBe("image/png");
    expect(runtime.downloads.anchors[0]?.download).toBe("drawing.png");
    expect(runtime.downloads.revokedObjectUrls).toEqual(
      runtime.downloads.createdObjectUrls,
    );

    reverie.dispose();
  });

  it("preserves negative World bounds instead of assuming an origin", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 1920,
      height: 1080,
    });
    // The facade always creates bounds at origin `(0, 0)`, so the getter is
    // stubbed to cover a World whose origin lies above and left of the origin.
    vi.spyOn(World.prototype, "bounds", "get").mockReturnValue({
      x: -960,
      y: -540,
      width: 1920,
      height: 1080,
    });
    const renderSpy = vi.spyOn(ExportRenderer.prototype, "render");

    await reverie.download({ format: "png" });
    await flushScheduledTimers();

    expect(renderSpy).toHaveBeenCalledWith({
      x: -960,
      y: -540,
      width: 1920,
      height: 1080,
    });

    reverie.dispose();
  });

  it("requires an explicit region for an unbounded World", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const download = (): Promise<void> => reverie.download({ format: "png" });

    await expect(download()).rejects.toThrow(WebRangeError);
    await expect(download()).rejects.toThrow(
      `[${WebErrorDefinitions.EXPORT_REGION_REQUIRED.code}]`,
    );
    expect(runtime.downloads.createdObjectUrls).toHaveLength(0);

    reverie.dispose();
  });

  it("exports an explicit region of an unbounded World", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const renderSpy = vi.spyOn(ExportRenderer.prototype, "render");
    const region = { x: -500, y: -500, width: 1000, height: 1000 };

    await reverie.download({ format: "png", region });
    await flushScheduledTimers();

    expect(renderSpy).toHaveBeenCalledWith(region);
    expect(region).toEqual({ x: -500, y: -500, width: 1000, height: 1000 });

    reverie.dispose();
  });

  it("forwards JPEG options and uses JPEG delivery metadata", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const background = { r: 0, g: 0, b: 0, a: 255 };
    const encodeSpy = vi
      .spyOn(JPEGEncoder.prototype, "encode")
      .mockResolvedValue({
        data: new Uint8Array([1]),
        mimeType: "image/jpeg",
        extension: "jpg",
      });

    await reverie.download({ format: "jpeg", quality: 0.9, background });
    await flushScheduledTimers();

    expect(encodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ width: 8, height: 8 }),
      { quality: 0.9, background },
    );
    expect(runtime.downloads.blobs[0]?.type).toBe("image/jpeg");
    expect(runtime.downloads.anchors[0]?.download).toBe("drawing.jpg");

    reverie.dispose();
  });

  it("forwards WebP options to the WebP encoder", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const encodeSpy = vi
      .spyOn(WebPEncoder.prototype, "encode")
      .mockResolvedValue({
        data: new Uint8Array([1]),
        mimeType: "image/webp",
        extension: "webp",
      });

    await reverie.download({ format: "webp", quality: 0.5, lossless: false });
    await flushScheduledTimers();

    expect(encodeSpy).toHaveBeenCalledWith(expect.anything(), {
      quality: 0.5,
      lossless: false,
    });
    expect(runtime.downloads.blobs[0]?.type).toBe("image/webp");
    expect(runtime.downloads.anchors[0]?.download).toBe("drawing.webp");

    reverie.dispose();
  });

  it("omits encoder options the request leaves unspecified", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const encodeSpy = vi
      .spyOn(WebPEncoder.prototype, "encode")
      .mockResolvedValue({
        data: new Uint8Array([1]),
        mimeType: "image/webp",
        extension: "webp",
      });

    await reverie.download({ format: "webp" });
    await flushScheduledTimers();

    expect(encodeSpy).toHaveBeenCalledWith(expect.anything(), {});

    reverie.dispose();
  });

  it("forwards the PNG compression level to the PNG encoder", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const encodeSpy = vi.spyOn(PNGEncoder.prototype, "encode");

    await reverie.download({ format: "png", compressionLevel: 9 });
    await flushScheduledTimers();

    expect(encodeSpy).toHaveBeenCalledWith(expect.anything(), {
      compressionLevel: 9,
    });

    reverie.dispose();
  });

  it("installs the jpeg-js Buffer shim before encoding a JPEG", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const shimSpy = vi.spyOn(JPEGEncoder, "installJpegJsBufferShim");
    const encodeSpy = vi
      .spyOn(JPEGEncoder.prototype, "encode")
      .mockResolvedValue({
        data: new Uint8Array([1]),
        mimeType: "image/jpeg",
        extension: "jpg",
      });

    await reverie.download({ format: "jpeg" });
    await flushScheduledTimers();

    expect(shimSpy).toHaveBeenCalledTimes(1);
    expect(encodeSpy).toHaveBeenCalledWith(expect.anything(), {});

    reverie.dispose();
  });

  it("does not touch the jpeg-js Buffer shim for non-JPEG formats", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    const shimSpy = vi.spyOn(JPEGEncoder, "installJpegJsBufferShim");

    await reverie.download({ format: "webp" });
    await flushScheduledTimers();

    expect(shimSpy).not.toHaveBeenCalled();

    reverie.dispose();
  });

  it("does not modify the Raster or drawing state while exporting", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 16,
      height: 16,
    });
    const raster = reverie.activeLayer.raster;
    const camera = reverie.camera;
    const brush = reverie.brush;
    const sampleRegion = { x: 0, y: 0, width: 16, height: 16 };

    raster.setPixel({ x: 2, y: 3 }, { r: 255, g: 0, b: 0, a: 255 });
    const pixelsBefore = new ExportRenderer({ raster }).render(
      sampleRegion,
    ).pixels;

    await reverie.download({ format: "png" });
    await flushScheduledTimers();

    expect(new ExportRenderer({ raster }).render(sampleRegion).pixels).toEqual(
      pixelsBefore,
    );
    expect(raster.getPixel({ x: 2, y: 3 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(raster.getPixel({ x: 15, y: 15 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(reverie.camera).toBe(camera);
    expect(reverie.brush).toBe(brush);

    reverie.dispose();
  });

  it("rejects a download after disposal", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
    });
    reverie.dispose();

    await expect(reverie.download({ format: "png" })).rejects.toThrow(WebError);
    await expect(reverie.download({ format: "png" })).rejects.toThrow(
      `[${WebErrorDefinitions.REVERIE_CANVAS_DISPOSED.code}]`,
    );
    expect(runtime.downloads.createdObjectUrls).toHaveLength(0);
  });
});

/** Minimal pointer data accepted by the Session's DOM handlers. */
interface TestPointerEvent {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;
  readonly pointerType?: string;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
}

/** Deterministic pointer fields applied before a test-specific override. */
const DEFAULT_POINTER_FIELDS = {
  button: 0,
  pointerId: 0,
  clientX: 0,
  clientY: 0,
  timeStamp: 0,
  pointerType: "mouse",
  pressure: 0.5,
  tiltX: 0,
  tiltY: 0,
};

/** Fills omitted pointer fields with deterministic Session defaults. */
function createPointerFields(pointer: TestPointerEvent): PointerEvent {
  return {
    ...DEFAULT_POINTER_FIELDS,
    ...pointer,
  } as unknown as PointerEvent;
}

/** Fake observer exposing lifecycle state for assertions. */
class TestResizeObserver {
  observedTarget: Element | null = null;
  hasDisconnected = false;

  /** Retains the callback only to match the browser constructor contract. */
  constructor(private readonly callback: ResizeObserverCallback) {
    void this.callback;
  }

  /** Records the observed element. */
  observe(target: Element): void {
    this.observedTarget = target;
  }

  /** Included for structural ResizeObserver compatibility. */
  unobserve(): void {}

  /** Records that owned observer resources were released. */
  disconnect(): void {
    this.hasDisconnected = true;
  }
}

/** Canvas fake supporting rendering, listeners, layout, and pointer capture. */
class TestCanvas {
  width = 0;
  height = 0;
  readonly ownerDocument: Document;
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  private readonly capturedPointers = new Set<number>();
  private readonly context = createRenderingContext();

  /** Returns the number of currently registered DOM listener identities. */
  get listenerCount(): number {
    let count = 0;

    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }

    return count;
  }

  /** Creates a canvas associated with the supplied fake document. */
  constructor(ownerDocument: Document) {
    this.ownerDocument = ownerDocument;
  }

  /** Returns the reusable 2D context fake. */
  getContext(contextIdentifier: string): CanvasRenderingContext2D | null {
    return contextIdentifier === "2d" ? this.context : null;
  }

  /** Returns stable CSS layout dimensions for camera conversion and resize. */
  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 16,
      bottom: 16,
      width: 16,
      height: 16,
      toJSON(): object {
        return {};
      },
    };
  }

  /** Registers one listener by its identity. */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  /** Removes one previously registered listener identity. */
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Marks a pointer as captured by this canvas. */
  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  /** Reports whether this canvas currently captures a pointer. */
  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  /** Releases a captured pointer. */
  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

  /** Dispatches sufficient PointerEvent behavior to registered Session handlers. */
  dispatchPointer(
    type: string,
    pointer: TestPointerEvent,
    coalescedEvents: readonly TestPointerEvent[] = [],
  ): void {
    const event = {
      ...createPointerFields(pointer),
      preventDefault(): void {},
      getCoalescedEvents(): readonly PointerEvent[] {
        return coalescedEvents.map(createPointerFields);
      },
    };

    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    }
  }
}

/** Browser primitives created for one isolated facade test. */
interface TestCanvasRuntime {
  readonly canvas: HTMLCanvasElement & TestCanvas;
  readonly observer: TestResizeObserver | null;
  readonly downloads: DownloadTestRuntime;
  readonly runNextFrame: () => void;
}

/** Creates deterministic Canvas, DOM lifecycle, and animation-frame primitives. */
function createCanvasRuntime(): TestCanvasRuntime {
  const frameCallbacks = new Map<number, FrameCallback>();
  let nextFrameHandle = 0;
  let currentObserver: TestResizeObserver | null = null;
  let ownerDocument: Document;

  class RuntimeResizeObserver extends TestResizeObserver {
    /** Creates and exposes the latest observer instance. */
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      currentObserver = this;
    }
  }

  const runtimeWindow = {
    devicePixelRatio: 1,
    ResizeObserver: RuntimeResizeObserver,
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as Window;

  ownerDocument = {
    defaultView: runtimeWindow,
    createElement(tagName: string): TestCanvas {
      if (tagName !== "canvas") {
        throw new Error(`Unexpected element request: ${tagName}`);
      }

      return new TestCanvas(ownerDocument);
    },
  } as unknown as Document;

  const testCanvas = new TestCanvas(ownerDocument);
  const downloads = new DownloadTestRuntime();
  downloads.install();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameCallback): number => {
    const handle = nextFrameHandle;
    nextFrameHandle += 1;
    frameCallbacks.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number): void => {
    frameCallbacks.delete(handle);
  });

  return {
    canvas: testCanvas as HTMLCanvasElement & TestCanvas,
    downloads,
    get observer(): TestResizeObserver | null {
      return currentObserver;
    },
    runNextFrame(): void {
      const nextEntry = frameCallbacks.entries().next();

      if (nextEntry.done) {
        throw new Error("No animation frame is pending.");
      }

      const [handle, callback] = nextEntry.value;
      frameCallbacks.delete(handle);
      callback(0);
    },
  };
}

/** Creates only the 2D APIs exercised by CanvasRenderer in facade tests. */
function createRenderingContext(): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: false,
    clearRect(): void {},
    drawImage(): void {},
    createImageData(width: number, height: number): ImageData {
      return {
        width,
        height,
        colorSpace: "srgb",
        data: new Uint8ClampedArray(width * height * 4),
      };
    },
    putImageData(): void {},
  } as unknown as CanvasRenderingContext2D;
}
