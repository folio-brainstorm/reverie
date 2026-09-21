import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CircleBrush,
  deriveStrokeSeed,
  ErrorCodes,
  PixelBrush,
  SelectionMask,
  Stroke,
  World,
} from "@reverie/core";
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
  it("adopts an existing World without changing its document state", () => {
    const runtime = createCanvasRuntime();
    const world = new World({ id: "adopted-world", tileSize: 2 });
    world.getLayer(0).raster.setPixel(
      { x: -1, y: -1 },
      {
        r: 12,
        g: 24,
        b: 36,
        a: 0,
      },
    );

    const reverie = new ReverieCanvas({ canvas: runtime.canvas, world });

    expect(reverie.world).toBe(world);
    expect(reverie.activeLayer).toBe(world.getLayer(0));
    expect(reverie.activeLayer.raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 12,
      g: 24,
      b: 36,
      a: 0,
    });
    reverie.dispose();
  });

  it("rejects geometry options when adopting an existing World", () => {
    const runtime = createCanvasRuntime();

    expect(
      () =>
        new ReverieCanvas({
          canvas: runtime.canvas,
          world: new World(),
          width: 16,
          height: 16,
        }),
    ).toThrow(`[${WebErrorDefinitions.INCOMPATIBLE_INITIAL_WORLD.code}]`);
  });

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
    expect(reverie.renderer.world).toBe(reverie.world);
    expect(reverie.world.layers).toEqual([reverie.activeLayer]);
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

  it("captures eraser mode for the next stroke only", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    reverie.activeLayer.raster.setPixel(
      { x: 0, y: 0 },
      { r: 50, g: 60, b: 70, a: 255 },
    );
    reverie.setPaintMode("erase");

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });
    runtime.runNextFrame();

    expect(reverie.paintMode).toBe("erase");
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 50,
      g: 60,
      b: 70,
      a: 0,
    });
    reverie.dispose();
  });

  it("captures Selection for queued work and rejects replacement while busy", () => {
    const runtime = createCanvasRuntime();
    const selection = SelectionMask.fromRect({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      brush: new PixelBrush({
        size: 3,
        color: { r: 10, g: 20, b: 30, a: 255 },
      }),
      selection,
    });

    expect(reverie.selection).toBe(selection);
    expect(reverie.session.selection).toBe(selection);
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });
    expect(() => reverie.setSelection(null)).toThrow(
      `[${WebErrorDefinitions.SELECTION_CHANGE_WHILE_BUSY.code}]`,
    );
    runtime.canvas.dispatchPointer("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 2,
    });
    expect(() => reverie.setSelection(null)).toThrow(
      `[${WebErrorDefinitions.SELECTION_CHANGE_WHILE_BUSY.code}]`,
    );

    runtime.runNextFrame();
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(reverie.activeLayer.raster.getPixel({ x: 1, y: 0 }).a).toBe(0);

    reverie.setSelection(null);
    expect(reverie.selection).toBeNull();
    reverie.dispose();
  });

  it("rejects malformed Selection values and replacement after disposal", () => {
    const runtime = createCanvasRuntime();
    const invalidConfig: ReverieCanvasConfig = {
      canvas: runtime.canvas,
      // @ts-expect-error Runtime validation protects JavaScript callers.
      selection: {},
    };

    expect(() => new ReverieCanvas(invalidConfig)).toThrow(
      `[${WebErrorDefinitions.INVALID_SELECTION.code}]`,
    );

    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    reverie.dispose();
    expect(() => reverie.session.setSelection(null)).toThrow(
      `[${WebErrorDefinitions.SELECTION_CHANGE_WHILE_DISPOSED.code}]`,
    );
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

describe("ReverieCanvas active-layer editing", () => {
  it("commits removal selection even when another before observer disposes the session", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const removed = reverie.activeLayer;
    const replacement = reverie.world.addLayer();
    reverie.world.observeLayerRemoval({
      beforeRemove: () => reverie.session.dispose(),
    });
    expect(() => reverie.world.removeLayer(removed)).not.toThrow();
    expect(reverie.activeLayer).toBe(replacement);
    expect(reverie.session.layer).toBe(replacement);
    expect(reverie.session.raster).toBe(replacement.raster);
    expect(() => reverie.session.setLayer(replacement)).toThrow("EC_WEB_0022");
    reverie.dispose();
  });

  it("blocks target changes and new strokes inside removal callbacks", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const removed = reverie.activeLayer;
    const replacement = reverie.world.addLayer();
    reverie.world.observeLayerRemoval({
      beforeRemove: () => {
        expect(() => reverie.setActiveLayer(replacement)).toThrow(
          "EC_WEB_0023",
        );
        runtime.canvas.dispatchPointer("pointerdown", {
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          timeStamp: 0,
        });
        expect(reverie.session.isPainting).toBe(false);
      },
    });
    reverie.world.removeLayer(removed);
    expect(reverie.activeLayer).toBe(replacement);
    expect(reverie.session.nextStrokeSequence).toBe(0);
    reverie.dispose();
  });

  it("releases target reservations when a later observer rejects removal", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const active = reverie.activeLayer;
    const other = reverie.world.addLayer();
    const stop = reverie.world.observeLayerRemoval({
      beforeRemove: () => {
        throw new Error("rejected");
      },
    });
    expect(() => reverie.world.removeLayer(active)).toThrow("rejected");
    expect(reverie.session.layer).toBe(active);
    expect(() => reverie.setActiveLayer(other)).not.toThrow();
    stop();
    reverie.dispose();
  });

  it("permanently closes and releases resources when the stroke-end callback throws", () => {
    const runtime = createCanvasRuntime();
    const failure = new Error("stroke-end failure");
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      onStrokeEnd: () => {
        throw failure;
      },
    });
    const active = reverie.activeLayer;
    const replacement = reverie.world.addLayer();
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      timeStamp: 0,
    });
    expect(() => reverie.dispose()).toThrow(failure);
    expect(runtime.canvas.listenerCount).toBe(0);
    expect(runtime.observer?.hasDisconnected).toBe(true);
    expect(() => reverie.dispose()).not.toThrow();
    expect(() => reverie.setActiveLayer(replacement)).toThrow("EC_WEB_0012");
    expect(() => reverie.session.setLayer(replacement)).toThrow("EC_WEB_0022");
    expect(() => reverie.world.removeLayer(active)).not.toThrow();
    expect(reverie.activeLayer).toBe(active);
    expect(() => runtime.runNextFrame()).toThrow(
      "No animation frame is pending.",
    );
    expect(active.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it("preserves simultaneous stroke-end and scheduler teardown failures", () => {
    const runtime = createCanvasRuntime();
    const strokeFailure = new Error("stroke-end failure");
    const schedulerFailure = new Error("cancel failure");
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      onStrokeEnd: () => {
        throw strokeFailure;
      },
    });
    const active = reverie.activeLayer;
    reverie.world.addLayer();
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      timeStamp: 0,
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      throw schedulerFailure;
    });
    let failure: unknown;
    try {
      reverie.dispose();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) {
      throw new Error("Expected all teardown failures to be preserved.");
    }
    expect(failure.errors).toEqual([strokeFailure, schedulerFailure]);
    expect(runtime.canvas.listenerCount).toBe(0);
    expect(runtime.observer?.hasDisconnected).toBe(true);
    expect(() => reverie.world.removeLayer(active)).not.toThrow();
    expect(() => reverie.dispose()).not.toThrow();
    runtime.runNextFrame();
    expect(active.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it("switches the editing target without altering document order or composition", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 8,
      height: 8,
      tileSize: 2,
    });
    const bottom = reverie.activeLayer;
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const top = reverie.world.addLayer();
    const before = new ExportRenderer({ world: reverie.world }).render({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const layers = reverie.world.layers;
    reverie.setActiveLayer(top);
    expect(reverie.activeLayer).toBe(top);
    expect(reverie.session.layer).toBe(top);
    expect(reverie.session.raster).toBe(top.raster);
    expect(reverie.world.layers).toBe(layers);
    expect(
      new ExportRenderer({ world: reverie.world }).render({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toEqual(before);
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 0,
    });
    runtime.runNextFrame();
    expect(top.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(bottom.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    reverie.dispose();
  });

  it("rejects changes throughout a stroke and until queued stamps finish, including direct World removal", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const target = reverie.activeLayer;
    const other = reverie.world.addLayer();
    const pointer = {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 0,
    };
    runtime.canvas.dispatchPointer("pointerdown", pointer);
    const busyCode = WebErrorDefinitions.LAYER_CHANGE_WHILE_BUSY.code;
    expect(() => reverie.setActiveLayer(other)).toThrow(busyCode);
    expect(() => reverie.world.removeLayer(target)).toThrow(busyCode);
    expect(() => reverie.removeLayer()).toThrow(busyCode);
    runtime.canvas.dispatchPointer("pointerup", { ...pointer, timeStamp: 1 });
    expect(reverie.session.isPainting).toBe(false);
    expect(() => reverie.setActiveLayer(other)).toThrow(busyCode);
    expect(() => reverie.world.removeLayer(target)).toThrow(busyCode);
    expect(reverie.world.layers).toEqual([target, other]);
    runtime.runNextFrame();
    expect(target.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(other.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    reverie.setActiveLayer(other);
    expect(reverie.activeLayer).toBe(other);
    reverie.dispose();
  });

  it("rejects switching even after queued work drains if the pointer is still down", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const other = reverie.world.addLayer();
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 0,
    });
    runtime.runNextFrame();
    expect(() => reverie.setActiveLayer(other)).toThrow(
      WebErrorDefinitions.LAYER_CHANGE_WHILE_BUSY.code,
    );
    reverie.dispose();
  });

  it("rejects deleting a nonactive layer while a Stroke transaction is active", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const active = reverie.activeLayer;
    const other = reverie.world.addLayer();
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 0,
    });
    expect(() => reverie.world.removeLayer(other)).toThrow(
      `[${ErrorCodes.HISTORY.DOCUMENT_MUTATION_DURING_RASTER_EDIT}]`,
    );
    expect(() => reverie.removeLayer(other)).toThrow(
      `[${WebErrorDefinitions.LAYER_CHANGE_WHILE_BUSY.code}]`,
    );
    expect(reverie.world.layers).toEqual([active, other]);
    expect(reverie.activeLayer).toBe(active);
    runtime.runNextFrame();
    expect(active.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    reverie.dispose();
  });

  it("selects the lower neighbor after direct removal, then the upper neighbor when at the bottom", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const bottom = reverie.activeLayer;
    const middle = reverie.world.addLayer();
    const top = reverie.world.addLayer();
    reverie.setActiveLayer(middle);
    reverie.world.removeLayer(middle);
    expect(reverie.activeLayer).toBe(bottom);
    expect(reverie.session.layer).toBe(bottom);
    reverie.removeLayer(bottom);
    expect(reverie.activeLayer).toBe(top);
    expect(reverie.session.raster).toBe(top.raster);
    expect(() => reverie.removeLayer(top)).toThrow("EC_WORLD_0005");
    expect(reverie.activeLayer).toBe(top);
    reverie.dispose();
  });

  it("keeps selection stable when reordered and clear affects only the active layer", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const bottom = reverie.activeLayer;
    const top = reverie.world.addLayer();
    for (const layer of reverie.world.layers) {
      layer.raster.setPixel({ x: 0, y: 0 }, { r: 10, g: 20, b: 30, a: 255 });
    }
    reverie.world.moveLayer(bottom, 1);
    expect(reverie.activeLayer).toBe(bottom);
    reverie.clear();
    expect(bottom.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    expect(top.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    reverie.dispose();
  });

  it("rejects invalid selection and detaches removal observers on disposal", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const active = reverie.activeLayer;
    const other = reverie.world.addLayer();
    expect(() => reverie.setActiveLayer(-1)).toThrow("EC_WORLD_0003");
    expect(() => reverie.setActiveLayer(new World().getLayer(0))).toThrow(
      "EC_WORLD_0004",
    );
    expect(reverie.activeLayer).toBe(active);
    reverie.dispose();
    expect(() => reverie.setActiveLayer(other)).toThrow(
      WebErrorDefinitions.REVERIE_CANVAS_DISPOSED.code,
    );
    expect(() => reverie.removeLayer(other)).toThrow(
      WebErrorDefinitions.REVERIE_CANVAS_DISPOSED.code,
    );
    expect(reverie.world.removeLayer(active)).toBe(active);
  });

  it("downloads the entire composition even when a different layer is active", async () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 1,
      height: 1,
      tileSize: 2,
    });
    const bottom = reverie.activeLayer;
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const top = reverie.world.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    top.opacity = 0.5;
    const encode = vi.spyOn(PNGEncoder.prototype, "encode");
    await reverie.download({ format: "png" });
    await flushScheduledTimers();
    expect(encode.mock.calls[0]?.[0].pixels).toEqual(
      new Uint8ClampedArray([128, 0, 128, 255]),
    );
    expect(reverie.activeLayer).toBe(bottom);
    expect(top.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    reverie.dispose();
  });
});

describe("ReverieCanvas History", () => {
  it("records every asynchronously scheduled stamp in one Stroke entry", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      width: 32,
      height: 32,
      brush: new PixelBrush({
        size: 1,
        color: { r: 255, g: 0, b: 0, a: 255 },
        spacing: 1,
      }),
    });

    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });
    runtime.canvas.dispatchPointer("pointermove", {
      button: 0,
      pointerId: 1,
      clientX: 4.5,
      clientY: 0.5,
      timeStamp: 2,
    });
    runtime.canvas.dispatchPointer("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 4.5,
      clientY: 0.5,
      timeStamp: 3,
    });
    runtime.runNextFrame();

    expect(reverie.canUndo).toBe(true);
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(reverie.activeLayer.raster.getPixel({ x: 4, y: 0 }).a).toBe(255);
    reverie.undo();
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    expect(reverie.activeLayer.raster.getPixel({ x: 4, y: 0 }).a).toBe(0);
    expect(reverie.canUndo).toBe(false);

    reverie.redo();
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(reverie.activeLayer.raster.getPixel({ x: 4, y: 0 }).a).toBe(255);
    reverie.dispose();
  });

  it("rejects Undo while a Stroke or queued drawing work is active", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });

    expect(() => reverie.undo()).toThrow(WebError);
    expect(() => reverie.undo()).toThrow(
      `[${WebErrorDefinitions.HISTORY_CHANGE_WHILE_BUSY.code}]`,
    );

    runtime.canvas.dispatchPointer("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 2,
    });
    runtime.runNextFrame();
    reverie.dispose();
  });

  it("restores Layer identity, order, properties, and active-Layer validity", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    const first = reverie.activeLayer;
    const second = reverie.addLayer();
    expect(reverie.activeLayer).toBe(second);

    reverie.undo();
    expect(reverie.world.layers).toEqual([first]);
    expect(reverie.activeLayer).toBe(first);
    reverie.redo();
    expect(reverie.world.layers[1]).toBe(second);
    expect(reverie.activeLayer).toBe(first);

    reverie.beginHistoryGroup();
    reverie.setLayerName(second, "Ink");
    reverie.setLayerOpacity(second, 0.4);
    reverie.setLayerVisibility(second, false);
    reverie.setLayerBlendMode(second, "multiply");
    reverie.commitHistoryGroup();
    reverie.undo();
    expect(second.name).toBe("Layer 2");
    expect(second.opacity).toBe(1);
    expect(second.visible).toBe(true);
    expect(second.blendMode).toBe("normal");
    reverie.dispose();
  });

  it("records clear and invalidates Redo after a new Layer edit", () => {
    const runtime = createCanvasRuntime();
    const reverie = new ReverieCanvas({ canvas: runtime.canvas });
    reverie.activeLayer.raster.setPixel(
      { x: 0, y: 0 },
      { r: 10, g: 20, b: 30, a: 255 },
    );

    reverie.clear();
    reverie.undo();
    expect(reverie.activeLayer.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(reverie.canRedo).toBe(true);

    reverie.setLayerName(reverie.activeLayer, "Paint");
    expect(reverie.canRedo).toBe(false);
    reverie.dispose();
  });

  it("keeps Selection session state unchanged across painting Undo", () => {
    const runtime = createCanvasRuntime();
    const selection = SelectionMask.fromRect({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const reverie = new ReverieCanvas({
      canvas: runtime.canvas,
      selection,
    });
    runtime.canvas.dispatchPointer("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 1,
    });
    runtime.canvas.dispatchPointer("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 0.5,
      clientY: 0.5,
      timeStamp: 2,
    });
    runtime.runNextFrame();

    reverie.undo();

    expect(reverie.selection).toBe(selection);
    expect(selection.getCoverage(0, 0)).toBe(1);
    reverie.dispose();
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
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    rect(): void {},
    clip(): void {},
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
