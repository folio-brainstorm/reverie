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
  StrokeConfig,
  StrokeSample,
  WorldPoint,
} from "@reverie/core";

describe("Stroke construction and lifecycle", () => {
  it("is available with its contracts through the public package entry point", () => {
    const raster = new Raster();
    const positions: WorldPoint[] = [];
    const brush = createRecordingBrush(positions);
    const config: StrokeConfig = { raster, brush };
    const stroke = new Stroke(config);
    const sample: StrokeSample = {
      position: { x: 0.25, y: -0.5 },
      timestamp: 10,
    };

    stroke.addSample(sample);

    expect(stroke.rawSamples).toEqual([sample]);
    expect(positions).toEqual([sample.position]);
    expect(stroke.isEnded).toBe(false);
  });

  it("defensively preserves raw samples without exposing mutable state", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions),
    });
    const sample = { position: { x: 1, y: 2 }, timestamp: 3 };

    stroke.addSample(sample);
    sample.position.x = 100;
    const exposedSamples = stroke.rawSamples;
    exposedSamples[0]!.position.y = 200;

    expect(stroke.rawSamples).toEqual([
      { position: { x: 1, y: 2 }, timestamp: 3 },
    ]);
  });

  it("ends idempotently without forcing a final off-spacing stamp", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.25),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 18, y: 0 }, timestamp: 1 });
    stroke.end();
    stroke.end();

    expect(stroke.isEnded).toBe(true);
    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ]);
  });

  it("rejects samples after the stroke has ended", () => {
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });

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
      new Stroke({
        raster: new Raster(),
        brush: createRecordingBrush([], size, spacing),
      });

    expect(createStroke).toThrow(ReverieRangeError);
    expect(createStroke).toThrow(
      `[${ErrorCodes.STROKE.INVALID_STAMP_DISTANCE}]`,
    );
  });
});

describe("linear stamp placement", () => {
  it("places the first stamp immediately for a click stroke", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions),
    });

    stroke.addSample({ position: { x: 4.5, y: -2.25 }, timestamp: 0 });
    stroke.end();

    expect(positions).toEqual([{ x: 4.5, y: -2.25 }]);
  });

  it("places stamps at fixed world distances including an aligned endpoint", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 100, y: 0 }, timestamp: 1 });

    expect(positions).toEqual(
      Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 0 })),
    );
  });

  it("uses Euclidean distance along a diagonal segment", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 30, y: 40 }, timestamp: 1 });

    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 8 },
      { x: 12, y: 16 },
      { x: 18, y: 24 },
      { x: 24, y: 32 },
      { x: 30, y: 40 },
    ]);
  });

  it("carries unused distance across short sample segments", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 6, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 12, y: 0 }, timestamp: 2 });

    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("continues accumulated distance around a piecewise-linear corner", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 8, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 8, y: 8 }, timestamp: 2 });

    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 2 },
    ]);
  });

  it("fills a sparsely sampled high-speed movement", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 20, 0.5),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 500, y: 0 }, timestamp: 1 });

    expect(positions).toHaveLength(51);
    expect(positions.at(-1)).toEqual({ x: 500, y: 0 });
  });

  it("produces identical stamps for dense and sparse collinear sampling", () => {
    const sparsePositions: WorldPoint[] = [];
    const densePositions: WorldPoint[] = [];
    const sparseStroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(sparsePositions, 20, 0.5),
    });
    const denseStroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(densePositions, 20, 0.5),
    });

    sparseStroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    sparseStroke.addSample({ position: { x: 100, y: 0 }, timestamp: 10 });

    for (let x = 0; x <= 100; x += 10) {
      denseStroke.addSample({
        position: { x, y: 0 },
        timestamp: x / 10,
      });
    }

    expect(densePositions).toEqual(sparsePositions);
  });

  it("stores zero-length samples without placing duplicate stamps", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions),
    });

    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 1 });

    expect(stroke.rawSamples).toHaveLength(2);
    expect(positions).toEqual([{ x: 10, y: 10 }]);
  });

  it("preserves fractional and negative interpolated positions", () => {
    const positions: WorldPoint[] = [];
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush(positions, 2, 0.5),
    });

    stroke.addSample({ position: { x: -2.5, y: 0.25 }, timestamp: 0 });
    stroke.addSample({ position: { x: 0.5, y: 0.25 }, timestamp: 1 });

    expect(positions).toEqual([
      { x: -2.5, y: 0.25 },
      { x: -1.5, y: 0.25 },
      { x: -0.5, y: 0.25 },
      { x: 0.5, y: 0.25 },
    ]);
  });

  it("uses only the configured Brush contract to paint an actual raster", () => {
    const raster = new Raster();
    const stroke = new Stroke({
      raster,
      brush: new CircleBrush({
        size: 2,
        spacing: 0.5,
        color: { r: 0, g: 255, b: 0, a: 255 },
      }),
    });

    stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    stroke.addSample({ position: { x: 4.5, y: 0.5 }, timestamp: 1 });

    for (let x = 0; x <= 4; x += 1) {
      expect(raster.getPixel({ x, y: 0 }).a).toBe(255);
    }
  });
});

describe("Stroke sample validation", () => {
  it("allows equal timestamps", () => {
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 1 });

    expect(() =>
      stroke.addSample({ position: { x: 1, y: 0 }, timestamp: 1 }),
    ).not.toThrow();
  });

  it("rejects decreasing timestamps without saving the sample", () => {
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 2 });
    const addSample = () =>
      stroke.addSample({ position: { x: 1, y: 0 }, timestamp: 1 });

    expect(addSample).toThrow(ReverieRangeError);
    expect(addSample).toThrow(`[${ErrorCodes.STROKE.NON_MONOTONIC_TIMESTAMP}]`);
    expect(stroke.rawSamples).toHaveLength(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid timestamp %s",
    (timestamp) => {
      const stroke = new Stroke({
        raster: new Raster(),
        brush: createRecordingBrush([]),
      });
      const addSample = () =>
        stroke.addSample({ position: { x: 0, y: 0 }, timestamp });

      expect(addSample).toThrow(ReverieRangeError);
      expect(addSample).toThrow(`[${ErrorCodes.STROKE.INVALID_TIMESTAMP}]`);
    },
  );

  it("rejects a non-number timestamp at runtime", () => {
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });
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
      const stroke = new Stroke({
        raster: new Raster(),
        brush: createRecordingBrush([]),
      });
      const addSample = () =>
        stroke.addSample({ position: { x, y: 0 }, timestamp: 0 });

      expect(addSample).toThrow(ReverieRangeError);
      expect(addSample).toThrow(`[${ErrorCodes.STROKE.NON_FINITE_POSITION}]`);
    },
  );

  it("rejects a non-number position component at runtime", () => {
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });
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
    const stroke = new Stroke({
      raster: new Raster(),
      brush: createRecordingBrush([]),
    });

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
  });
});

/** Creates a Brush test double that records every requested stamp position. */
function createRecordingBrush(
  positions: WorldPoint[],
  size = 20,
  spacing = 0.5,
): Brush {
  return {
    size,
    spacing,
    stamp(_raster, position): void {
      positions.push({ ...position });
    },
  };
}
