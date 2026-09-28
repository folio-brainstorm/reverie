import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  PixelBrush,
  Raster,
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
  Stroke,
} from "@reveriejs/core";
import type {
  Brush,
  StampCommand,
  StrokeConfig,
  StrokeSample,
  StrokeSampleInput,
  WorldPoint,
} from "@reveriejs/core";

describe("Stroke construction and lifecycle", () => {
  it("exposes its brush and command contracts through the public package entry point", () => {
    const brush = createRecordingBrush([]);
    const config: StrokeConfig = { brush };
    const stroke = new Stroke(config);
    const sample: StrokeSampleInput = {
      position: { x: 0.25, y: -0.5 },
      timestamp: 10,
    };

    stroke.addSample(sample);
    const command: StampCommand | undefined = stroke.nextStamp();

    expect(stroke.brush).toBe(brush);
    expect(stroke.rawSamples).toEqual([
      normalizedSample({ x: 0.25, y: -0.5 }, 10),
    ]);
    expect(stroke.processedSamples).toEqual([
      normalizedSample({ x: 0.25, y: -0.5 }, 10),
    ]);
    expect(command?.timestamp).toBe(10);
    expect(command?.position).toEqual({ x: 0.25, y: -0.5 });
    expect(stroke.isEnded).toBe(false);
  });

  it("defensively preserves raw, processed, and queued command positions", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });
    const sample = { position: { x: 1, y: 2 }, timestamp: 3 };

    stroke.addSample(sample);
    sample.position.x = 100;
    const exposedSamples = stroke.rawSamples;
    const exposedProcessedSamples = stroke.processedSamples;
    exposedSamples[0]!.position.y = 200;
    exposedProcessedSamples[0]!.position.y = 300;

    expect(stroke.rawSamples).toEqual([normalizedSample({ x: 1, y: 2 }, 3)]);
    expect(stroke.processedSamples).toEqual([
      normalizedSample({ x: 1, y: 2 }, 3),
    ]);
    expect(stroke.nextStamp()?.position).toEqual({ x: 1, y: 2 });
  });

  it("ends idempotently without discarding or adding pending commands", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.25),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 18, y: 0 }, timestamp: 1 });
    stroke.end();
    stroke.end();

    expect(stroke.isEnded).toBe(true);
    expect(stroke.pendingStampCount).toBe(4);
    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ]);
  });

  it("rejects samples after the stroke has ended", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.end();
    const addSample = () =>
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });

    expect(addSample).toThrow(ReverieError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.ALREADY_ENDED}]`);
  });

  it.each([
    [0, 0],
    [-1, 0.5],
    [Number.MAX_VALUE, 2],
  ])("rejects unsafe brush metrics size %s spacing %s", (size, spacing) => {
    const createStroke = () =>
      new Stroke({ brush: createRecordingBrush([], size, spacing) });

    expect(createStroke).toThrow(ReverieRangeError);
    expect(createStroke).toThrow(
      `[${ErrorCodes.STROKE.INVALID_STAMP_DISTANCE}]`,
    );
  });

  it.each([0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid smoothing %s",
    (smoothing) => {
      const createStroke = () =>
        new Stroke({ brush: createRecordingBrush([]), smoothing });

      expect(createStroke).toThrow(ReverieRangeError);
      expect(createStroke).toThrow(`[${ErrorCodes.STROKE.INVALID_SMOOTHING}]`);
    },
  );

  it("rejects a non-number smoothing value at runtime", () => {
    const createStroke = () =>
      new Stroke({
        brush: createRecordingBrush([]),
        // @ts-expect-error Runtime validation protects JavaScript callers.
        smoothing: "0.5",
      });

    expect(createStroke).toThrow(ReverieTypeError);
    expect(createStroke).toThrow(`[${ErrorCodes.STROKE.INVALID_NUMBER_TYPE}]`);
  });

  it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects invalid resample distance %s",
    (resampleDistance) => {
      const createStroke = () =>
        new Stroke({ brush: createRecordingBrush([]), resampleDistance });

      expect(createStroke).toThrow(ReverieRangeError);
      expect(createStroke).toThrow(
        `[${ErrorCodes.STROKE.INVALID_RESAMPLE_DISTANCE}]`,
      );
    },
  );

  it("rejects a non-number resample distance at runtime", () => {
    const createStroke = () =>
      new Stroke({
        brush: createRecordingBrush([]),
        // @ts-expect-error Runtime validation protects JavaScript callers.
        resampleDistance: "1",
      });

    expect(createStroke).toThrow(ReverieTypeError);
    expect(createStroke).toThrow(`[${ErrorCodes.STROKE.INVALID_NUMBER_TYPE}]`);
  });
});

describe("stroke smoothing and resampling", () => {
  it("preserves raw positions when smoothing is one", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 20, y: 0 }, timestamp: 2 });

    expect(stroke.processedSamples).toEqual(stroke.rawSamples);
  });

  it("applies streaming EMA before resampling", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 0.5,
      resampleDistance: 2.5,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 10 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 20 });

    expect(stroke.rawSamples.map((sample) => sample.position.x)).toEqual([
      0, 10, 10,
    ]);
    expect(stroke.processedSamples.map((sample) => sample.position.x)).toEqual([
      0, 2.5, 5, 7.5,
    ]);
  });

  it("smooths fractional negative coordinates without quantization", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 0.5,
      resampleDistance: 0.5,
    });

    stroke.addSample({
      position: { x: -10.25, y: -20.125 },
      timestamp: 0,
    });
    stroke.addSample({
      position: { x: -11.25, y: -20.125 },
      timestamp: 1,
    });

    expect(stroke.processedSamples.at(-1)).toEqual(
      normalizedSample({ x: -10.75, y: -20.125 }, 1),
    );
  });

  it("emits fixed-distance samples and interpolates timestamps", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 5,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 20, y: 0 }, timestamp: 100 });

    expect(stroke.processedSamples).toEqual([
      normalizedSample({ x: 0, y: 0 }, 0),
      normalizedSample({ x: 5, y: 0 }, 25),
      normalizedSample({ x: 10, y: 0 }, 50),
      normalizedSample({ x: 15, y: 0 }, 75),
      normalizedSample({ x: 20, y: 0 }, 100),
    ]);
  });

  it("carries resampling remainder across input segment boundaries", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 6, y: 0 }, timestamp: 6 });
    stroke.addSample({ position: { x: 12, y: 0 }, timestamp: 12 });

    expect(stroke.processedSamples).toEqual([
      normalizedSample({ x: 0, y: 0 }, 0),
      normalizedSample({ x: 10, y: 0 }, 10),
    ]);
  });

  it("carries resampling distance around a corner", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 8, y: 0 }, timestamp: 8 });
    stroke.addSample({ position: { x: 8, y: 8 }, timestamp: 16 });

    expect(stroke.processedSamples).toEqual([
      normalizedSample({ x: 0, y: 0 }, 0),
      normalizedSample({ x: 8, y: 2 }, 10),
    ]);
  });

  it("produces the same processed straight path from sparse and dense input", () => {
    const createStroke = () =>
      new Stroke({
        brush: createRecordingBrush([]),
        smoothing: 1,
        resampleDistance: 5,
      });
    const sparseStroke = createStroke();
    const denseStroke = createStroke();

    sparseStroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    sparseStroke.addSample({ position: { x: 100, y: 0 }, timestamp: 100 });

    for (let x = 0; x <= 100; x += 10) {
      denseStroke.addSample({
        position: { x, y: 0 },
        timestamp: x,
      });
    }

    expectSamplesToBeClose(
      denseStroke.processedSamples,
      sparseStroke.processedSamples,
    );
  });

  it("reduces the amplitude of noisy input", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 0.5,
      resampleDistance: 5,
    });
    const yCoordinates = [0, 1, -1, 1, -1];

    yCoordinates.forEach((y, index) => {
      stroke.addSample({
        position: { x: index * 10, y },
        timestamp: index,
      });
    });

    const processedAmplitude = Math.max(
      ...stroke.processedSamples.map((sample) => Math.abs(sample.position.y)),
    );
    expect(processedAmplitude).toBeLessThan(1);
  });

  it("keeps processed path density independent from brush metrics", () => {
    const firstStroke = new Stroke({
      brush: createRecordingBrush([], 2, 0.5),
      resampleDistance: 2,
    });
    const secondStroke = new Stroke({
      brush: createRecordingBrush([], 10, 1),
      resampleDistance: 2,
    });

    for (const stroke of [firstStroke, secondStroke]) {
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
      stroke.addSample({ position: { x: 20, y: 0 }, timestamp: 20 });
    }

    expect(firstStroke.processedSamples).toEqual(secondStroke.processedSamples);
    expect(firstStroke.processedSamples).toHaveLength(11);
    expect(drainStampPositions(firstStroke)).toHaveLength(21);
    expect(drainStampPositions(secondStroke)).toHaveLength(3);
  });

  it("keeps a click as one raw sample, processed sample, and stamp", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 4, y: -3 }, timestamp: 2 });

    expect(stroke.rawSamples).toHaveLength(1);
    expect(stroke.processedSamples).toHaveLength(1);
    expect(stroke.pendingStampCount).toBe(1);
  });

  it("paints the final pixel when a short stroke crosses a pixel boundary", () => {
    const raster = new Raster();
    const brush = new PixelBrush({
      size: 1,
      spacing: 0.25,
      color: { r: 255, g: 0, b: 0, a: 255 },
    });
    const stroke = new Stroke({ brush });
    stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    stroke.addSample({ position: { x: 1.4, y: 0.5 }, timestamp: 1 });
    stroke.end();

    let command = stroke.nextStamp();
    while (command !== undefined) {
      brush.stamp(raster, command.position, command);
      command = stroke.nextStamp();
    }
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(raster.getPixel({ x: 1, y: 0 }).a).toBe(255);
  });

  it("does not append a duplicate stamp for a short same-pixel tail", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([], 1, 1) });
    stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    stroke.addSample({ position: { x: 0.9, y: 0.5 }, timestamp: 1 });
    stroke.end();
    stroke.end();

    expect(drainStampPositions(stroke)).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it("appends final-tail commands after normal long-stroke stamps at unchanged spacing", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([], 1, 0.5) });
    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 2.4, y: 0 }, timestamp: 1 });

    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 1.5, y: 0 },
      { x: 2, y: 0 },
    ]);
    stroke.end();
    expect(drainStampPositions(stroke)).toEqual([]);

    const tailStroke = new Stroke({ brush: createRecordingBrush([], 1, 0.25) });
    tailStroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    tailStroke.addSample({ position: { x: 2.9, y: 0 }, timestamp: 1 });
    expect(drainStampPositions(tailStroke).at(-1)).toEqual({ x: 2, y: 0 });
    tailStroke.end();
    expect(drainStampPositions(tailStroke)).toEqual([
      { x: 2.25, y: 0 },
      { x: 2.5, y: 0 },
      { x: 2.75, y: 0 },
    ]);
  });

  it("stores repeated zero-length raw input without duplicate outputs", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 1 });

    expect(stroke.rawSamples).toHaveLength(3);
    expect(stroke.processedSamples).toHaveLength(1);
    expect(stroke.pendingStampCount).toBe(1);
  });
});

describe("pending stamp queue", () => {
  it("queues the first sample without executing the brush", () => {
    const executedPositions: WorldPoint[] = [];
    const stroke = new Stroke({
      brush: createRecordingBrush(executedPositions),
    });

    stroke.addSample({ position: { x: 4.5, y: -2.25 }, timestamp: 0 });

    expect(executedPositions).toEqual([]);
    expect(stroke.hasPendingStamps).toBe(true);
    expect(stroke.pendingStampCount).toBe(1);
    expect(stroke.nextStamp()?.position).toEqual({ x: 4.5, y: -2.25 });
    expect(stroke.hasPendingStamps).toBe(false);
    expect(stroke.pendingStampCount).toBe(0);
  });

  it("returns undefined when the queue is empty", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    expect(stroke.nextStamp()).toBeUndefined();

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    expect(stroke.nextStamp()).toBeDefined();
    expect(stroke.nextStamp()).toBeUndefined();
  });

  it("preserves FIFO order for every generated command", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 30, y: 0 }, timestamp: 1 });

    expect(stroke.pendingStampCount).toBe(4);
    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("continues from the next command after partial consumption", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 90, y: 0 }, timestamp: 1 });

    expect(stroke.pendingStampCount).toBe(10);
    expect(stroke.nextStamp()?.position).toEqual({ x: 0, y: 0 });
    expect(stroke.nextStamp()?.position).toEqual({ x: 10, y: 0 });
    expect(stroke.nextStamp()?.position).toEqual({ x: 20, y: 0 });
    expect(stroke.pendingStampCount).toBe(7);
    expect(stroke.nextStamp()?.position).toEqual({ x: 30, y: 0 });
  });

  it("appends new commands behind unread work during partial consumption", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 30, y: 0 }, timestamp: 1 });
    expect(stroke.nextStamp()?.position).toEqual({ x: 0, y: 0 });
    expect(stroke.nextStamp()?.position).toEqual({ x: 10, y: 0 });

    stroke.addSample({ position: { x: 50, y: 0 }, timestamp: 2 });

    expect(stroke.pendingStampCount).toBe(4);
    expect(drainStampPositions(stroke)).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("can append more work after the queue has been fully drained", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    expect(stroke.nextStamp()?.position).toEqual({ x: 0, y: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 1 });

    expect(stroke.pendingStampCount).toBe(1);
    expect(stroke.nextStamp()?.position).toEqual({ x: 10, y: 0 });
  });

  it("allows all remaining work to be consumed after end", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 20, y: 0 }, timestamp: 1 });
    stroke.end();

    expect(stroke.isEnded).toBe(true);
    expect(stroke.hasPendingStamps).toBe(true);
    expect(drainStampPositions(stroke)).toHaveLength(3);
    expect(stroke.isEnded).toBe(true);
    expect(stroke.hasPendingStamps).toBe(false);
  });

  it("leaves Raster unchanged until an external consumer executes commands", () => {
    const raster = new Raster();
    const brush = new CircleBrush({
      size: 2,
      spacing: 0.5,
      color: { r: 0, g: 255, b: 0, a: 255 },
    });
    const stroke = new Stroke({ brush });

    stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    stroke.addSample({ position: { x: 4.5, y: 0.5 }, timestamp: 1 });

    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);

    while (stroke.hasPendingStamps) {
      const command = stroke.nextStamp();

      if (command === undefined) {
        break;
      }

      stroke.brush.stamp(raster, command.position, command);
    }

    for (let x = 0; x <= 4; x += 1) {
      expect(raster.getPixel({ x, y: 0 }).a).toBe(255);
    }
  });
});

describe("linear stamp placement", () => {
  it("uses Euclidean distance along a diagonal segment", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 30, y: 40 }, timestamp: 1 });

    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 8 },
      { x: 12, y: 16 },
      { x: 18, y: 24 },
      { x: 24, y: 32 },
      { x: 30, y: 40 },
    ]);
  });

  it("carries unused distance across short sample segments", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 6, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 12, y: 0 }, timestamp: 2 });

    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("continues accumulated distance around a piecewise-linear corner", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 8, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 8, y: 8 }, timestamp: 2 });

    expect(drainStampPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 2 },
    ]);
  });

  it("fills a sparsely sampled high-speed movement with commands", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 500, y: 0 }, timestamp: 1 });

    const positions = drainStampPositions(stroke);
    expect(positions).toHaveLength(51);
    expect(positions.at(-1)).toEqual({ x: 500, y: 0 });
  });

  it("produces identical commands for dense and sparse collinear sampling", () => {
    const sparseStroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });
    const denseStroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    sparseStroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    sparseStroke.addSample({ position: { x: 100, y: 0 }, timestamp: 10 });

    for (let x = 0; x <= 100; x += 10) {
      denseStroke.addSample({
        position: { x, y: 0 },
        timestamp: x / 10,
      });
    }

    expect(drainStampPositions(denseStroke)).toEqual(
      drainStampPositions(sparseStroke),
    );
  });

  it("stores zero-length samples without queuing duplicate commands", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 1 });

    expect(stroke.rawSamples).toHaveLength(2);
    expect(drainStampPositions(stroke)).toEqual([{ x: 10, y: 10 }]);
  });

  it("preserves fractional and negative interpolated positions", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 2, 0.5),
    });

    stroke.addSample({ position: { x: -2.5, y: 0.25 }, timestamp: 0 });
    stroke.addSample({ position: { x: 0.5, y: 0.25 }, timestamp: 1 });

    expect(drainStampPositions(stroke)).toEqual([
      { x: -2.5, y: 0.25 },
      { x: -1.5, y: 0.25 },
      { x: -0.5, y: 0.25 },
      { x: 0.5, y: 0.25 },
    ]);
  });
});

describe("Stroke sample validation", () => {
  it("allows equal timestamps", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 1 });

    expect(() =>
      stroke.addSample({ position: { x: 1, y: 0 }, timestamp: 1 }),
    ).not.toThrow();
  });

  it("rejects decreasing timestamps without saving the sample", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 2 });
    const addSample = () =>
      stroke.addSample({ position: { x: 1, y: 0 }, timestamp: 1 });

    expect(addSample).toThrow(ReverieRangeError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.NON_MONOTONIC_TIMESTAMP}]`);
    expect(stroke.rawSamples).toHaveLength(1);
    expect(stroke.pendingStampCount).toBe(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid timestamp %s",
    (timestamp) => {
      const stroke = new Stroke({ brush: createRecordingBrush([]) });
      const addSample = () =>
        stroke.addSample({ position: { x: 0, y: 0 }, timestamp });

      expect(addSample).toThrow(ReverieRangeError);
      expect(addSample).toThrow(`[${ErrorCodes.STROKE.INVALID_TIMESTAMP}]`);
    },
  );

  it("rejects a non-number timestamp at runtime", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });
    const addSample = () =>
      stroke.addSample({
        position: { x: 0, y: 0 },
        // @ts-expect-error Runtime validation protects JavaScript callers.
        timestamp: "0",
      });

    expect(addSample).toThrow(ReverieTypeError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.INVALID_NUMBER_TYPE}]`);
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects invalid position component %s",
    (x) => {
      const stroke = new Stroke({ brush: createRecordingBrush([]) });
      const addSample = () =>
        stroke.addSample({ position: { x, y: 0 }, timestamp: 0 });

      expect(addSample).toThrow(ReverieRangeError);
      expect(addSample).toThrow(`[${ErrorCodes.STROKE.NON_FINITE_POSITION}]`);
    },
  );

  it("rejects a non-number position component at runtime", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });
    const addSample = () =>
      stroke.addSample({
        position: {
          // @ts-expect-error Runtime validation protects JavaScript callers.
          x: "0",
          y: 0,
        },
        timestamp: 0,
      });

    expect(addSample).toThrow(ReverieTypeError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.INVALID_NUMBER_TYPE}]`);
  });

  it("rejects finite positions whose displacement overflows", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({
      position: { x: -Number.MAX_VALUE, y: 0 },
      timestamp: 0,
    });
    const addSample = () =>
      stroke.addSample({
        position: { x: Number.MAX_VALUE, y: 0 },
        timestamp: 1,
      });

    expect(addSample).toThrow(ReverieRangeError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.NON_FINITE_SEGMENT}]`);
    expect(stroke.rawSamples).toHaveLength(1);
    expect(stroke.pendingStampCount).toBe(1);
  });
});

describe("extended stroke sample input", () => {
  it("preserves supplied pressure and tilt in raw samples", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({
      position: { x: 10, y: 20 },
      timestamp: 100,
      pressure: 0.4,
      tiltX: -10,
      tiltY: 20,
    });

    expect(stroke.rawSamples).toEqual([
      {
        position: { x: 10, y: 20 },
        timestamp: 100,
        pressure: 0.4,
        tiltX: -10,
        tiltY: 20,
      },
    ]);
  });

  it("normalizes legacy input to the Core defaults", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 1, y: 2 }, timestamp: 3 });

    expect(stroke.rawSamples).toEqual([normalizedSample({ x: 1, y: 2 }, 3)]);
  });

  it.each([0, 0.5, 1])("accepts pressure %s", (pressure) => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    expect(() =>
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0, pressure }),
    ).not.toThrow();
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid pressure %s",
    (pressure) => {
      const stroke = new Stroke({ brush: createRecordingBrush([]) });
      const addSample = () =>
        stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0, pressure });

      expect(addSample).toThrow(ReverieRangeError);
      expect(addSample).toThrow(`[${ErrorCodes.STROKE.INVALID_PRESSURE}]`);
    },
  );

  it.each([-90, 0, 90])("accepts tilt %s on both axes", (tilt) => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    expect(() =>
      stroke.addSample({
        position: { x: 0, y: 0 },
        timestamp: 0,
        tiltX: tilt,
        tiltY: tilt,
      }),
    ).not.toThrow();
  });

  it.each([-90.1, 90.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tilt %s on either axis",
    (tilt) => {
      const stroke = new Stroke({ brush: createRecordingBrush([]) });
      const addTiltX = () =>
        stroke.addSample({
          position: { x: 0, y: 0 },
          timestamp: 0,
          tiltX: tilt,
        });
      const addTiltY = () =>
        stroke.addSample({
          position: { x: 0, y: 0 },
          timestamp: 0,
          tiltY: tilt,
        });

      expect(addTiltX).toThrow(`[${ErrorCodes.STROKE.INVALID_TILT}]`);
      expect(addTiltY).toThrow(`[${ErrorCodes.STROKE.INVALID_TILT}]`);
    },
  );

  it("interpolates pressure while resampling", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 5,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0, pressure: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 10, pressure: 1 });

    expect(stroke.processedSamples.map((sample) => sample.pressure)).toEqual([
      0, 0.5, 1,
    ]);
  });

  it("interpolates tilt and timestamps while resampling", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([]),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({
      position: { x: 0, y: 0 },
      timestamp: 0,
      tiltX: -30,
      tiltY: 90,
    });
    stroke.addSample({
      position: { x: 20, y: 0 },
      timestamp: 20,
      tiltX: 30,
      tiltY: -90,
    });

    const midpoint = stroke.processedSamples[1];

    expect(midpoint?.tiltX).toBeCloseTo(0);
    expect(midpoint?.tiltY).toBeCloseTo(0);
    expect(midpoint?.timestamp).toBeCloseTo(10);
  });

  it("interpolates input attributes at each stamp position", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 40, 0.5),
      smoothing: 1,
      resampleDistance: 80,
    });

    stroke.addSample({
      position: { x: 0, y: 0 },
      timestamp: 0,
      pressure: 0.2,
      tiltX: -45,
      tiltY: 30,
    });
    stroke.addSample({
      position: { x: 80, y: 0 },
      timestamp: 100,
      pressure: 1,
      tiltX: 45,
      tiltY: -30,
    });

    const commands = drainStampCommands(stroke);

    expectNumbersToBeClose(
      commands.map((command) => command.position.x),
      [0, 20, 40, 60, 80],
    );
    expectNumbersToBeClose(
      commands.map((command) => command.pressure),
      [0.2, 0.4, 0.6, 0.8, 1],
    );
    expectNumbersToBeClose(
      commands.map((command) => command.timestamp),
      [0, 25, 50, 75, 100],
    );
    expectNumbersToBeClose(
      commands.map((command) => command.tiltX),
      [-45, -22.5, 0, 22.5, 45],
    );
    expectNumbersToBeClose(
      commands.map((command) => command.tiltY),
      [30, 15, 0, -15, -30],
    );
    expectNumbersToBeClose(
      commands.map((command) => command.velocity),
      [0, 0.8, 0.8, 0.8, 0.8],
    );
  });

  it("derives velocity between neighboring actual stamps", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 10, 1),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 10 });

    expect(
      drainStampCommands(stroke).map((command) => command.velocity),
    ).toEqual([0, 1]);
  });

  it("uses zero velocity when neighboring stamps have equal timestamps", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 10, 1),
      smoothing: 1,
      resampleDistance: 10,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 5 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 5 });

    expect(
      drainStampCommands(stroke).map((command) => command.velocity),
    ).toEqual([0, 0]);
  });

  it("resets first-stamp velocity for each new stroke", () => {
    const createStroke = (): Stroke =>
      new Stroke({ brush: createRecordingBrush([], 10, 1) });
    const firstStroke = createStroke();
    const secondStroke = createStroke();

    firstStroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    firstStroke.addSample({ position: { x: 10, y: 0 }, timestamp: 10 });
    secondStroke.addSample({ position: { x: 100, y: 0 }, timestamp: 100 });

    expect(firstStroke.nextStamp()?.velocity).toBe(0);
    expect(secondStroke.nextStamp()?.velocity).toBe(0);
  });

  it("keeps input attributes finite across zero-length segments", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({
      position: { x: 5, y: 5 },
      timestamp: 0,
      pressure: 0.5,
      tiltX: 10,
      tiltY: -10,
    });
    stroke.addSample({
      position: { x: 5, y: 5 },
      timestamp: 1,
      pressure: 0.75,
      tiltX: 20,
      tiltY: -20,
    });

    expect(drainStampCommands(stroke)).toEqual([
      {
        position: { x: 5, y: 5 },
        timestamp: 0,
        pressure: 0.5,
        tiltX: 10,
        tiltY: -10,
        velocity: 0,
        strokeSeed: stroke.strokeSeed,
        stampIndex: 0,
      },
    ]);
  });

  it("carries supplied input on a single click", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({
      position: { x: 4, y: -3 },
      timestamp: 2,
      pressure: 0.3,
      tiltX: -12,
      tiltY: 8,
    });

    expect(drainStampCommands(stroke)).toEqual([
      {
        position: { x: 4, y: -3 },
        timestamp: 2,
        pressure: 0.3,
        tiltX: -12,
        tiltY: 8,
        velocity: 0,
        strokeSeed: stroke.strokeSeed,
        stampIndex: 0,
      },
    ]);
  });

  it("normalizes a legacy click to the Core defaults", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });

    stroke.addSample({ position: { x: 4, y: -3 }, timestamp: 2 });

    expect(drainStampCommands(stroke)).toEqual([
      {
        ...normalizedSample({ x: 4, y: -3 }, 2),
        velocity: 0,
        strokeSeed: stroke.strokeSeed,
        stampIndex: 0,
      },
    ]);
  });

  it("renders identical pixels regardless of supplied input attributes", () => {
    const plainRaster = new Raster();
    const extendedRaster = new Raster();
    const createBrush = (): CircleBrush =>
      new CircleBrush({
        size: 6,
        spacing: 0.5,
        color: { r: 0, g: 255, b: 0, a: 255 },
      });
    const plainStroke = new Stroke({ brush: createBrush() });
    const extendedStroke = new Stroke({ brush: createBrush() });

    plainStroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    plainStroke.addSample({ position: { x: 12.5, y: 0.5 }, timestamp: 16 });
    extendedStroke.addSample({
      position: { x: 0.5, y: 0.5 },
      timestamp: 0,
      pressure: 0.2,
      tiltX: -45,
      tiltY: 30,
    });
    extendedStroke.addSample({
      position: { x: 12.5, y: 0.5 },
      timestamp: 16,
      pressure: 1,
      tiltX: 45,
      tiltY: -30,
    });

    executeAllStamps(plainStroke, plainRaster);
    executeAllStamps(extendedStroke, extendedRaster);

    for (let x = 0; x <= 16; x += 1) {
      for (let y = 0; y <= 6; y += 1) {
        expect(extendedRaster.getPixel({ x, y })).toEqual(
          plainRaster.getPixel({ x, y }),
        );
      }
    }
  });
});

/** Removes all pending commands and returns their positions in FIFO order. */
function drainStampPositions(stroke: Stroke): WorldPoint[] {
  const positions: WorldPoint[] = [];

  while (stroke.hasPendingStamps) {
    const command = stroke.nextStamp();

    if (command === undefined) {
      break;
    }

    positions.push({ ...command.position });
  }

  return positions;
}

/** Removes all pending commands and returns them in FIFO order. */
function drainStampCommands(stroke: Stroke): StampCommand[] {
  const commands: StampCommand[] = [];

  while (stroke.hasPendingStamps) {
    const command = stroke.nextStamp();

    if (command === undefined) {
      break;
    }

    commands.push(command);
  }

  return commands;
}

/** Executes every pending command of a stroke into the supplied raster. */
function executeAllStamps(stroke: Stroke, raster: Raster): void {
  while (stroke.hasPendingStamps) {
    const command = stroke.nextStamp();

    if (command === undefined) {
      break;
    }

    stroke.brush.stamp(raster, command.position, command);
  }
}

/** Adds Core defaults to one position and timestamp for canonical comparisons. */
function normalizedSample(
  position: WorldPoint,
  timestamp: number,
): StrokeSample {
  return { position, timestamp, pressure: 1, tiltX: 0, tiltY: 0 };
}

/** Compares numeric command attributes within floating-point tolerance. */
function expectNumbersToBeClose(
  actual: readonly (number | undefined)[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);

  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!);
  });
}

/** Compares mathematically equivalent paths independent of float evaluation order. */
function expectSamplesToBeClose(
  actual: readonly StrokeSample[],
  expected: readonly StrokeSample[],
): void {
  expect(actual).toHaveLength(expected.length);

  actual.forEach((sample, index) => {
    const expectedSample = expected[index]!;
    expect(sample.position.x).toBeCloseTo(expectedSample.position.x);
    expect(sample.position.y).toBeCloseTo(expectedSample.position.y);
    expect(sample.timestamp).toBeCloseTo(expectedSample.timestamp);
  });
}

/** Creates a Brush test double that records only externally executed stamps. */
function createRecordingBrush(
  executedPositions: WorldPoint[],
  size = 20,
  spacing = 0.5,
): Brush {
  return {
    size,
    spacing,
    stamp(_raster, position): void {
      executedPositions.push({ ...position });
    },
  };
}
