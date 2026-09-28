import { describe, expect, it } from "vitest";

import {
  BrushImage,
  CircleBrush,
  deriveStrokeSeed,
  ErrorCodes,
  ImageBrush,
  Raster,
  Stroke,
} from "@reveriejs/core";
import type { Brush, StampCommand, StrokeConfig } from "@reveriejs/core";

const COLOR = { r: 84, g: 153, b: 255, a: 255 };
const BRUSH_FACTORIES = [
  {
    name: "CircleBrush",
    create(): CircleBrush {
      return new CircleBrush({
        size: 6,
        opacity: 0.6,
        color: COLOR,
        seed: 0xffffffff,
        jitter: { size: 0.3, opacity: 0.3, rotation: 0.5 },
        scatter: { along: 0.25, across: 0.15 },
      });
    },
  },
  {
    name: "ImageBrush",
    create(): ImageBrush {
      return new ImageBrush({
        image: new BrushImage({
          width: 2,
          height: 1,
          alpha: new Uint8Array([255, 96]),
        }),
        size: 6,
        opacity: 0.6,
        color: COLOR,
        seed: 0xffffffff,
        dynamics: { rotation: { direction: {} } },
        jitter: { size: 0.3, opacity: 0.3, rotation: 0.5 },
        scatter: { along: 0.25, across: 0.15 },
      });
    },
  },
];

describe("Stroke deterministic stamp identity", () => {
  it("starts at zero and keeps indices when the queue is drained and input emits no stamps", () => {
    const stroke = new Stroke({ brush: metricsBrush(), strokeSequence: 7 });
    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    const first = stroke.nextStamp();
    expect(first?.stampIndex).toBe(0);
    expect(first?.strokeSeed).toBe(stroke.strokeSeed);
    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 1 });
    stroke.addSample({ position: { x: 0.5, y: 0 }, timestamp: 2 });
    expect(stroke.nextStamp()).toBeUndefined();
    stroke.addSample({ position: { x: 2, y: 0 }, timestamp: 3 });
    expect(drain(stroke).map((command) => command.stampIndex)).toEqual([1, 2]);
  });

  it("preserves emission indices across queue compaction and appended work", () => {
    const stroke = new Stroke({ brush: metricsBrush() });
    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 2050, y: 0 }, timestamp: 2050 });
    for (let index = 0; index < 1500; index += 1) {
      expect(stroke.nextStamp()?.stampIndex).toBe(index);
    }
    stroke.addSample({ position: { x: 2052, y: 0 }, timestamp: 2052 });
    const commands = drain(stroke);
    expect(commands.map((command) => command.stampIndex)).toEqual(
      Array.from({ length: 553 }, (_, index) => index + 1500),
    );
    expect(
      commands.every((command) => command.strokeSeed === stroke.strokeSeed),
    ).toBe(true);
  });

  it("derives from brush seed and recorded sequence while legacy brushes default to zero", () => {
    const brush = new CircleBrush({ size: 1, color: COLOR, seed: 0x80000000 });
    expect(new Stroke({ brush, strokeSequence: 7 }).strokeSeed).toBe(
      deriveStrokeSeed(0x80000000, 7),
    );
    expect(new Stroke({ brush: metricsBrush() }).strokeSeed).toBe(
      deriveStrokeSeed(0, 0),
    );
    expect(new Stroke({ brush, strokeSequence: 7 }).strokeSeed).not.toBe(
      new Stroke({ brush, strokeSequence: 8 }).strokeSeed,
    );
  });

  it.each([0, 0x80000000, 0xffffffff])(
    "restores final seed %s without rehashing it",
    (strokeSeed) => {
      const stroke = new Stroke({
        brush: metricsBrush(),
        strokeSequence: 99,
        strokeSeed,
      });
      expect(stroke.strokeSeed).toBe(strokeSeed);
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
      expect(stroke.nextStamp()?.strokeSeed).toBe(strokeSeed);
    },
  );

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "rejects invalid seed context %s",
    (invalid) => {
      expect(
        () => new Stroke({ brush: metricsBrush(), strokeSeed: invalid }),
      ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
      expect(
        () => new Stroke({ brush: metricsBrush(), strokeSequence: invalid }),
      ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
      expect(
        () => new Stroke({ brush: { ...metricsBrush(), seed: invalid } }),
      ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
    },
  );

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "ignores unused derivation inputs %s when a final seed is restored",
    (invalid) => {
      const stroke = new Stroke({
        brush: { ...metricsBrush(), seed: invalid },
        strokeSequence: invalid,
        strokeSeed: 0,
      });
      expect(stroke.strokeSeed).toBe(0);
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
      expect(stroke.nextStamp()?.strokeSeed).toBe(0);
    },
  );

  it("emits the last uint32 index then reports stroke-domain exhaustion without wrapping", () => {
    const stroke = new Stroke({ brush: metricsBrush() });
    // Fast-forward only the counter to avoid allocating 2^32 commands; assertions
    // exercise public emission and errors rather than calling private methods.
    Object.defineProperty(stroke, "nextStampIndex", {
      value: 0xffffffff,
      writable: true,
    });
    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    expect(stroke.nextStamp()?.stampIndex).toBe(0xffffffff);
    expect(() =>
      stroke.addSample({ position: { x: 1, y: 0 }, timestamp: 1 }),
    ).toThrow(`[${ErrorCodes.STROKE.STAMP_INDEX_EXHAUSTED}]`);
    expect(stroke.nextStamp()).toBeUndefined();
  });
});

describe.each(BRUSH_FACTORIES)(
  "$name deterministic stroke replay",
  ({ create }) => {
    it("restores saved seed and plain command data to byte-identical pixels", () => {
      const brush = create();
      const original = generateStroke({ brush, strokeSequence: 17 });
      const commands = drain(original);
      const serialized: unknown = JSON.parse(JSON.stringify(commands));
      expect(serialized).toEqual(commands);
      const source = paint(brush, commands);
      const restored = generateStroke({
        brush: create(),
        strokeSeed: original.strokeSeed,
        strokeSequence: 99,
      });
      const restoredCommands = drain(restored);
      expect(restoredCommands).toEqual(commands);
      expect(paint(restored.brush, restoredCommands)).toEqual(source);
      expect(source.some((byte) => byte > 0)).toBe(true);

      // Rebuild the command data without asserting the type of JSON.parse output.
      const replay = commands.map((command) => ({
        ...command,
        position: { ...command.position },
      }));
      expect(paint(create(), replay)).toEqual(source);
    });

    it("changes the variation and pixels for a different stroke seed", () => {
      const brush = create();
      const first = generateStroke({ brush, strokeSeed: 0 });
      const second = generateStroke({ brush, strokeSeed: 1 });
      expect(paint(brush, drain(first))).not.toEqual(
        paint(brush, drain(second)),
      );
    });

    it("keeps command identity when consumption is interleaved with input", () => {
      const brush = create();
      const buffered = generateStroke({ brush, strokeSeed: 42 });
      const streaming = new Stroke({ brush, strokeSeed: 42 });
      const commands: StampCommand[] = [];
      for (const sample of buffered.rawSamples) {
        streaming.addSample(sample);
        commands.push(...drain(streaming));
      }
      streaming.end();
      expect(commands).toEqual(drain(buffered));
    });
  },
);

/** Builds a neutral legacy brush without a seed property or any painting. */
function metricsBrush(): Brush {
  return { size: 1, spacing: 1, stamp(): void {} };
}

/** Generates a short cornered stroke with interpolated pressure and tilt input. */
function generateStroke(config: StrokeConfig): Stroke {
  const stroke = new Stroke(config);
  stroke.addSample({
    position: { x: 0.5, y: 0.5 },
    timestamp: 0,
    pressure: 0.4,
    tiltX: 10,
  });
  stroke.addSample({
    position: { x: 20.5, y: 0.5 },
    timestamp: 20,
    pressure: 0.8,
    tiltX: 30,
  });
  stroke.addSample({
    position: { x: 20.5, y: 12.5 },
    timestamp: 32,
    pressure: 0.6,
    tiltY: 20,
  });
  stroke.end();
  return stroke;
}

/** Drains commands without painting or changing emission identity. */
function drain(stroke: Stroke): StampCommand[] {
  const commands: StampCommand[] = [];
  for (
    let command = stroke.nextStamp();
    command !== undefined;
    command = stroke.nextStamp()
  ) {
    commands.push(command);
  }
  return commands;
}

/** Captures RGBA8 bytes across the complete bounds of these small replay strokes. */
function paint(brush: Brush, commands: readonly StampCommand[]): Uint8Array {
  const raster = new Raster({ tileSize: 16 });
  for (const command of commands) {
    brush.stamp(raster, command.position, command);
  }
  const bytes = new Uint8Array(40 * 32 * 4);
  let offset = 0;
  for (let y = -8; y < 24; y += 1) {
    for (let x = -8; x < 32; x += 1) {
      const pixel = raster.getPixel({ x, y });
      bytes.set([pixel.r, pixel.g, pixel.b, pixel.a], offset);
      offset += 4;
    }
  }
  return bytes;
}
