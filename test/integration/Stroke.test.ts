import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  Raster,
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
  Stroke,
} from "@reverie/core";
import type {
  Brush,
  StampCommand,
  StrokeConfig,
  StrokeSample,
  WorldPoint,
} from "@reverie/core";

describe("Stroke construction and lifecycle", () => {
  it("exposes its brush and command contracts through the public package entry point", () => {
    const brush = createRecordingBrush([]);
    const config: StrokeConfig = { brush };
    const stroke = new Stroke(config);
    const sample: StrokeSample = {
      position: { x: 0.25, y: -0.5 },
      timestamp: 10,
    };

    stroke.addSample(sample);
    const command: StampCommand | undefined = stroke.nextStamp();

    expect(stroke.brush).toBe(brush);
    expect(stroke.rawSamples).toEqual([sample]);
    expect(command).toEqual({ position: sample.position });
    expect(stroke.isEnded).toBe(false);
  });

  it("defensively preserves raw samples and queued command positions", () => {
    const stroke = new Stroke({ brush: createRecordingBrush([]) });
    const sample = { position: { x: 1, y: 2 }, timestamp: 3 };

    stroke.addSample(sample);
    sample.position.x = 100;
    const exposedSamples = stroke.rawSamples;
    exposedSamples[0]!.position.y = 200;

    expect(stroke.rawSamples).toEqual([
      { position: { x: 1, y: 2 }, timestamp: 3 },
    ]);
    expect(stroke.nextStamp()).toEqual({ position: { x: 1, y: 2 } });
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
    expect(stroke.nextStamp()).toEqual({
      position: { x: 4.5, y: -2.25 },
    });
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
    expect(stroke.nextStamp()).toEqual({ position: { x: 0, y: 0 } });
    expect(stroke.nextStamp()).toEqual({ position: { x: 10, y: 0 } });
    expect(stroke.nextStamp()).toEqual({ position: { x: 20, y: 0 } });
    expect(stroke.pendingStampCount).toBe(7);
    expect(stroke.nextStamp()).toEqual({ position: { x: 30, y: 0 } });
  });

  it("appends new commands behind unread work during partial consumption", () => {
    const stroke = new Stroke({
      brush: createRecordingBrush([], 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 30, y: 0 }, timestamp: 1 });
    expect(stroke.nextStamp()).toEqual({ position: { x: 0, y: 0 } });
    expect(stroke.nextStamp()).toEqual({ position: { x: 10, y: 0 } });

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
    expect(stroke.nextStamp()).toEqual({ position: { x: 0, y: 0 } });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 1 });

    expect(stroke.pendingStampCount).toBe(1);
    expect(stroke.nextStamp()).toEqual({ position: { x: 10, y: 0 } });
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

      stroke.brush.stamp(raster, command.position);
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
