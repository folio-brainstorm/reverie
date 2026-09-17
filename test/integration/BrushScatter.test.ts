import { describe, expect, it, vi } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ErrorCodes,
  ImageBrush,
  Raster,
  ReverieRangeError,
  ReverieTypeError,
  sampleStampRandom,
  STAMP_RANDOM_CHANNELS,
} from "@reverie/core";
import type { CircleBrushConfig, StampCommand } from "@reverie/core";

const COLOR = { r: 0, g: 255, b: 0, a: 255 };
const POSITION = { x: 20.5, y: 20.5 };
const BRUSH_FACTORIES = [
  {
    name: "CircleBrush",
    create(config: CircleBrushConfig): CircleBrush {
      return new CircleBrush(config);
    },
  },
  {
    name: "ImageBrush",
    create(config: CircleBrushConfig): ImageBrush {
      return new ImageBrush({
        image: new BrushImage({ width: 2, height: 1 }),
        ...config,
      });
    },
  },
];

describe.each(BRUSH_FACTORIES)("$name deterministic scatter", ({ create }) => {
  it.each([undefined, {}, { along: 0, across: 0 }])(
    "preserves legacy pixels when scatter is %j",
    (scatter) => {
      const config = { size: 6, opacity: 0.5, color: COLOR, rotation: 0.25 };
      const plain = create(config);
      const disabled = create({ ...config, scatter });
      const input = stamp({ strokeSeed: 42, stampIndex: 7, direction: 1.2 });
      const expected = new Raster();
      const actual = new Raster();
      plain.stamp(expected, POSITION, input);
      disabled.stamp(actual, POSITION, input);
      expectRasterEqual(actual, expected);
    },
  );

  it.each([
    [{ along: 1 }, 0],
    [{ across: 1 }, 0],
    [{ along: 1, across: 1 }, Math.PI / 4],
    [{ along: 1 }, Math.PI / 2],
    [{ across: 1 }, Math.PI / 2],
  ])(
    "uses the along/across basis for scatter %j at direction %s",
    (scatter, direction) => {
      const brush = create({ size: 6, opacity: 0.5, color: COLOR, scatter });
      const input = stamp({ strokeSeed: 0x80000000, stampIndex: 7, direction });
      const resolved = brush.resolveParameters(input);
      const equivalent = create({ ...resolved, color: COLOR });
      const actual = new Raster();
      const expected = new Raster();
      brush.stamp(actual, POSITION, input);
      equivalent.stamp(
        expected,
        scatteredPosition(POSITION, resolved.size, scatter, input),
      );
      expectRasterEqual(actual, expected);
    },
  );

  it("uses the positive x and y axes when command direction is absent", () => {
    const scatter = { along: 1, across: 1 };
    const brush = create({ size: 6, color: COLOR, scatter });
    const input = stamp({ strokeSeed: 42, stampIndex: 3 });
    const equivalent = create({ size: 6, color: COLOR });
    const actual = new Raster();
    const expected = new Raster();
    brush.stamp(actual, POSITION, input);
    equivalent.stamp(expected, scatteredPosition(POSITION, 6, scatter, input));
    expectRasterEqual(actual, expected);
  });

  it("scales offsets with the final size after jitter", () => {
    const scatter = { along: 1.5, across: 0.75 };
    const input = stamp({ strokeSeed: 0, stampIndex: 7, direction: 0.6 });
    const brush = create({
      size: 6,
      color: COLOR,
      seed: 0xffffffff,
      jitter: { size: 0.4 },
      scatter,
    });
    const resolved = brush.resolveParameters(input);
    const equivalent = create({ ...resolved, color: COLOR });
    const actual = new Raster();
    const expected = new Raster();
    brush.stamp(actual, POSITION, input);
    equivalent.stamp(
      expected,
      scatteredPosition(POSITION, resolved.size, scatter, input),
    );
    expectRasterEqual(actual, expected);
  });

  it("uses brush seed and index zero for direct stamps without hidden state", () => {
    const scatter = { along: 1.25, across: 0.75 };
    const brush = create({
      size: 6,
      color: COLOR,
      seed: 0x80000000,
      scatter,
    });
    const direct = new Raster();
    const explicit = new Raster();
    brush.stamp(direct, POSITION);
    brush.stamp(
      explicit,
      POSITION,
      stamp({ strokeSeed: brush.seed, stampIndex: 0 }),
    );
    expectRasterEqual(direct, explicit);
  });

  it("owns configured scatter so later mutations cannot change painted output", () => {
    const scatter = { along: 1.25, across: 0.75 };
    const config = { size: 6, color: COLOR, seed: 0x80000000, scatter };
    const brush = create(config);
    const input = stamp({ strokeSeed: 42, stampIndex: 3, direction: 0.5 });
    const expected = new Raster();
    brush.stamp(expected, POSITION, input);
    scatter.along = 100;
    scatter.across = 100;
    config.seed = 0;
    const actual = new Raster();
    brush.stamp(actual, POSITION, input);
    expectRasterEqual(actual, expected);
    expect(brush.seed).toBe(0x80000000);
  });

  it("does not mutate command geometry while painting from a scattered position", () => {
    const brush = create({
      size: 6,
      color: COLOR,
      scatter: { along: 1, across: 1 },
    });
    const input = stamp({
      position: { x: 3.5, y: 7.5 },
      strokeSeed: 42,
      stampIndex: 3,
      direction: 0.5,
    });
    const snapshot = { ...input, position: { ...input.position } };
    brush.stamp(new Raster(), POSITION, input);
    expect(input).toEqual(snapshot);
  });

  it("skips scatter and geometry when dynamics resolves a zero final size", () => {
    const cosine = vi.spyOn(Math, "cos");
    try {
      const brush = create({
        size: 6,
        color: COLOR,
        scatter: { along: 1, across: 1 },
        dynamics: { size: { pressure: { min: 0 } } },
      });
      const raster = new Raster();
      brush.stamp(
        raster,
        { x: Number.MAX_VALUE, y: 0 },
        stamp({ pressure: 0 }),
      );
      expect(cosine).not.toHaveBeenCalled();
      expectEmptyRaster(raster);
    } finally {
      cosine.mockRestore();
    }
  });

  it.each(["along", "across"])(
    "rejects invalid %s scatter amplitudes",
    (parameter) => {
      for (const invalid of [-1, -0.1, Number.NaN, Infinity, -Infinity]) {
        const construct = () =>
          create({ size: 6, color: COLOR, scatter: { [parameter]: invalid } });
        expect(construct).toThrow(ReverieRangeError);
        expect(construct).toThrow(
          `[${ErrorCodes.BRUSH.INVALID_SCATTER_AMPLITUDE}]`,
        );
      }
    },
  );

  it("rejects malformed scatter, invalid direction, and non-finite results", () => {
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => create({ size: 6, color: COLOR, scatter: null })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_SCATTER_OBJECT}]`,
    );
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => create({ size: 6, color: COLOR, scatter: [] })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_SCATTER_OBJECT}]`,
    );
    const brush = create({ size: 6, color: COLOR, scatter: { along: 1 } });
    expect(() =>
      brush.stamp(new Raster(), POSITION, stamp({ strokeSeed: -1 })),
    ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
    expect(() =>
      brush.stamp(
        new Raster(),
        POSITION,
        stamp({
          // @ts-expect-error Runtime validation protects JavaScript callers.
          direction: null,
        }),
      ),
    ).toThrow(`[${ErrorCodes.BRUSH.INVALID_SCATTER_DIRECTION}]`);
    const overflowing = create({
      size: Number.MAX_VALUE,
      color: COLOR,
      scatter: { along: Number.MAX_VALUE },
    });
    expect(() => overflowing.stamp(new Raster(), POSITION)).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_SCATTER_RESULT}]`,
    );
  });
});

describe("scatter source coordinate validation", () => {
  it("retains each brush's non-finite source-position error", () => {
    const circle = new CircleBrush({
      size: 6,
      color: COLOR,
      scatter: { along: 1 },
    });
    const image = new ImageBrush({
      image: new BrushImage({ width: 1, height: 1 }),
      size: 6,
      color: COLOR,
      scatter: { along: 1 },
    });

    expect(() => circle.stamp(new Raster(), { x: Number.NaN, y: 0 })).toThrow(
      `[${ErrorCodes.COMMON.INVALID_CIRCLE_CENTER}]`,
    );
    expect(() => image.stamp(new Raster(), { x: Number.NaN, y: 0 })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_STAMP_POSITION}]`,
    );
  });

  it("retains CircleBrush's type error for a nonnumeric source position", () => {
    const brush = new CircleBrush({
      size: 6,
      color: COLOR,
      scatter: { along: 1 },
    });

    const stamp = () => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      brush.stamp(new Raster(), { x: null, y: 0 });
    };

    expect(stamp).toThrow(ReverieTypeError);
    expect(stamp).toThrow(`[${ErrorCodes.COMMON.INVALID_COORDINATE_TYPE}]`);
  });
});
/** Calculates the public scatter contract independently of brush paint paths. */
function scatteredPosition(
  position: { x: number; y: number },
  size: number,
  scatter: { along?: number; across?: number },
  input: StampCommand,
): { x: number; y: number } {
  const seed = input.strokeSeed ?? 0;
  const index = input.stampIndex ?? 0;
  const direction = input.direction ?? 0;
  const along =
    (sampleStampRandom(seed, index, STAMP_RANDOM_CHANNELS.scatterAlong) * 2 -
      1) *
    size *
    (scatter.along ?? 0);
  const across =
    (sampleStampRandom(seed, index, STAMP_RANDOM_CHANNELS.scatterAcross) * 2 -
      1) *
    size *
    (scatter.across ?? 0);
  const cosine = Math.cos(direction);
  const sine = Math.sin(direction);
  return {
    x: position.x + cosine * along - sine * across,
    y: position.y + sine * along + cosine * across,
  };
}

/** Compares the bounded pixel region exercised by scatter without snapshots. */
function expectRasterEqual(actual: Raster, expected: Raster): void {
  for (let y = 0; y <= 40; y += 1) {
    for (let x = 0; x <= 40; x += 1) {
      expect(actual.getPixel({ x, y })).toEqual(expected.getPixel({ x, y }));
    }
  }
}

/** Creates a hand-authored command while leaving legacy optional fields absent. */
function stamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return { position: POSITION, ...overrides };
}

/** Checks observable transparency without creating implicit world-space work. */
function expectEmptyRaster(raster: Raster): void {
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      expect(raster.getPixel({ x, y })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    }
  }
}
