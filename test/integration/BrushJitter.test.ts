import { describe, expect, it, vi } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ErrorCodes,
  ImageBrush,
  Raster,
  ReverieRangeError,
  sampleStampRandom,
  STAMP_RANDOM_CHANNELS,
} from "@reverie/core";
import type { CircleBrushConfig, StampCommand } from "@reverie/core";

const COLOR = { r: 0, g: 255, b: 0, a: 255 };
const POSITION = { x: 0.5, y: 0.5 };
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

describe.each(BRUSH_FACTORIES)("$name deterministic jitter", ({ create }) => {
  it("defaults to disabled jitter and uint32 seed zero", () => {
    const brush = create({
      size: 20,
      opacity: 0.5,
      rotation: 0.25,
      color: COLOR,
    });
    expect(brush.seed).toBe(0);
    expect(brush.resolveParameters(stamp())).toEqual({
      size: 20,
      opacity: 0.5,
      rotation: 0.25,
    });
  });

  it.each([{}, { size: 0, opacity: 0, rotation: 0, spacing: 0 }])(
    "leaves every resolved value and painted pixel unchanged when jitter is %j",
    (jitter) => {
      const config = {
        size: 4,
        opacity: 0.5,
        rotation: 0.25,
        color: COLOR,
        dynamics: {
          size: { pressure: { min: 0.2 } },
          rotation: { direction: {} },
        },
      };
      const plain = create(config);
      const disabled = create({ ...config, jitter });
      const input = stamp({ pressure: 0.75, direction: Math.PI / 4 });
      expect(disabled.resolveParameters(input)).toEqual(
        plain.resolveParameters(input),
      );
      const plainRaster = new Raster();
      const disabledRaster = new Raster();
      plain.stamp(plainRaster, POSITION, input);
      disabled.stamp(disabledRaster, POSITION, input);
      for (let y = -4; y <= 4; y += 1) {
        for (let x = -4; x <= 4; x += 1) {
          expect(disabledRaster.getPixel({ x, y })).toEqual(
            plainRaster.getPixel({ x, y }),
          );
        }
      }
    },
  );

  it("keeps scalar multipliers and additive rotation inside configured bounds", () => {
    const brush = create({
      size: 20,
      opacity: 0.5,
      rotation: 0.25,
      color: COLOR,
      jitter: { size: 0.2, opacity: 0.2, rotation: Math.PI / 12 },
    });
    for (let stampIndex = 0; stampIndex < 128; stampIndex += 1) {
      const input = stamp({ strokeSeed: 0xffffffff, stampIndex });
      const resolved = brush.resolveParameters(input);
      expect(resolved.size).toBeGreaterThanOrEqual(16);
      expect(resolved.size).toBeLessThanOrEqual(24);
      expect(resolved.opacity).toBeGreaterThanOrEqual(0.4);
      expect(resolved.opacity).toBeLessThanOrEqual(0.6);
      expect(resolved.rotation - 0.25).toBeGreaterThanOrEqual(-Math.PI / 12);
      expect(resolved.rotation - 0.25).toBeLessThanOrEqual(Math.PI / 12);
      expect(brush.resolveParameters(input)).toEqual(resolved);
    }
  });

  it("applies jitter after pressure, velocity, direction, and tilt dynamics", () => {
    const config = {
      size: 20,
      opacity: 0.5,
      rotation: 0.25,
      color: COLOR,
      dynamics: {
        size: {
          pressure: { min: 0.2 },
          velocity: { min: 0.5, maxVelocity: 1 },
        },
        opacity: { pressure: { min: 0.1 } },
        rotation: { direction: {}, tilt: {} },
      },
    };
    const dynamics = create(config);
    const brush = create({
      ...config,
      jitter: { size: 0.2, opacity: 0.2, rotation: 0.5 },
    });
    const input = stamp({
      strokeSeed: 0x80000000,
      stampIndex: 7,
      pressure: 0.4,
      velocity: 0.3,
      direction: 1.2,
      tiltX: 30,
      tiltY: 10,
    });
    const snapshot = { ...input, position: { ...input.position } };
    const baseline = dynamics.resolveParameters(input);
    const expected = { ...baseline };
    const resolved = brush.resolveParameters(input);
    expect(resolved.size).toBe(
      baseline.size *
        (1 +
          (sampleStampRandom(0x80000000, 7, STAMP_RANDOM_CHANNELS.size) * 2 -
            1) *
            0.2),
    );
    expect(resolved.opacity).toBe(
      baseline.opacity *
        (1 +
          (sampleStampRandom(0x80000000, 7, STAMP_RANDOM_CHANNELS.opacity) * 2 -
            1) *
            0.2),
    );
    expect(resolved.rotation).toBe(
      baseline.rotation +
        (sampleStampRandom(0x80000000, 7, STAMP_RANDOM_CHANNELS.rotation) * 2 -
          1) *
          0.5,
    );
    expect(baseline).toEqual(expected);
    expect(input).toEqual(snapshot);
    expect(brush.size).toBe(20);
    expect(brush.opacity).toBe(0.5);
    expect(brush.rotation).toBe(0.25);
  });

  it("does not perturb size or rotation when opacity jitter is enabled", () => {
    const config = {
      size: 20,
      opacity: 0.5,
      color: COLOR,
      jitter: { size: 0.2, rotation: 0.5 },
    };
    const original = create(config);
    const extended = create({
      ...config,
      jitter: { ...config.jitter, opacity: 0.2 },
    });
    for (let stampIndex = 0; stampIndex < 32; stampIndex += 1) {
      const input = stamp({ strokeSeed: 42, stampIndex });
      const before = original.resolveParameters(input);
      sampleStampRandom(42, stampIndex, 0xdeadbeef);
      const after = extended.resolveParameters(input);
      expect(after.size).toBe(before.size);
      expect(after.rotation).toBe(before.rotation);
    }
  });

  it("owns configured jitter so later mutations do not change results", () => {
    const jitter = { size: 0.2, opacity: 0.2, rotation: 0.5 };
    const config = { size: 20, color: COLOR, seed: 0xffffffff, jitter };
    const brush = create(config);
    const expected = brush.resolveParameters(stamp());
    jitter.size = 100;
    jitter.opacity = 100;
    jitter.rotation = 100;
    config.seed = 0;
    expect(brush.resolveParameters(stamp())).toEqual(expected);
    expect(brush.seed).toBe(0xffffffff);
  });

  it("paints the final jitter parameters through the same path as static brush values", () => {
    const brush = create({
      size: 6,
      opacity: 0.5,
      color: COLOR,
      rotation: 0.25,
      jitter: { size: 0.2, opacity: 0.2, rotation: 1.5 },
    });
    const input = stamp({ strokeSeed: 0, stampIndex: 0 });
    const resolved = brush.resolveParameters(input);
    const equivalent = create({ ...resolved, color: COLOR });
    const actual = new Raster();
    const expected = new Raster();
    brush.stamp(actual, POSITION, input);
    equivalent.stamp(expected, POSITION);
    for (let y = -6; y <= 6; y += 1) {
      for (let x = -6; x <= 6; x += 1) {
        expect(actual.getPixel({ x, y })).toEqual(expected.getPixel({ x, y }));
      }
    }
  });

  it("uses the brush seed and index zero for direct stamps without hidden RNG state", () => {
    const brush = create({
      size: 4,
      color: COLOR,
      opacity: 0.5,
      seed: 0x80000000,
      jitter: { size: 0.2, opacity: 0.2, rotation: 0.5 },
    });
    const expected = brush.resolveParameters(
      stamp({ strokeSeed: 0x80000000, stampIndex: 0 }),
    );
    expect(brush.resolveParameters(stamp())).toEqual(expected);
    expect(brush.resolveParameters(stamp({ stampIndex: 1 }))).not.toEqual(
      expected,
    );
    const direct = new Raster();
    const explicit = new Raster();
    brush.stamp(direct, POSITION);
    brush.stamp(
      explicit,
      POSITION,
      stamp({ strokeSeed: brush.seed, stampIndex: 0 }),
    );
    for (let y = -4; y <= 4; y += 1) {
      for (let x = -4; x <= 4; x += 1) {
        expect(direct.getPixel({ x, y })).toEqual(explicit.getPixel({ x, y }));
      }
    }
  });

  it("clamps a negative size multiplier to a no-op stamp", () => {
    const brush = create({ size: 4, color: COLOR, jitter: { size: 2 } });
    const input = stamp({ strokeSeed: 0, stampIndex: 3 });
    const raster = new Raster();
    expect(brush.resolveParameters(input).size).toBe(0);
    brush.stamp(raster, POSITION, input);
    expectEmptyRaster(raster);
  });

  it("treats an exact zero multiplier as a no-op at the maximum stamp index", () => {
    const brush = create({ size: 4, color: COLOR, jitter: { size: 1 } });
    const input = stamp({
      // Independently computed uint32 channel hash makes this sample exactly zero.
      strokeSeed: 1364076727,
      stampIndex: 0xffffffff,
    });
    expect(brush.resolveParameters(input).size).toBe(0);
    const raster = new Raster();
    brush.stamp(raster, POSITION, input);
    expectEmptyRaster(raster);
  });

  it("preserves zero size and opacity resolved by dynamics", () => {
    const brush = create({
      size: 4,
      color: COLOR,
      dynamics: {
        size: { pressure: { min: 0 } },
        opacity: { pressure: { min: 0 } },
      },
      jitter: { size: Number.MAX_VALUE, opacity: Number.MAX_VALUE },
    });
    const input = stamp({ pressure: 0 });
    expect(brush.resolveParameters(input)).toEqual({
      size: 0,
      opacity: 0,
      rotation: 0,
    });
    const raster = new Raster();
    brush.stamp(raster, POSITION, input);
    expectEmptyRaster(raster);
  });

  it("clamps amplified opacity to one and negative opacity to zero", () => {
    const brush = create({
      size: 4,
      opacity: 0.9,
      color: COLOR,
      jitter: { opacity: 2 },
    });
    expect(
      brush.resolveParameters(stamp({ strokeSeed: 0, stampIndex: 3 })).opacity,
    ).toBe(1);
    const input = stamp({ strokeSeed: 0, stampIndex: 2 });
    expect(brush.resolveParameters(input).opacity).toBe(0);
    const raster = new Raster();
    brush.stamp(raster, POSITION, input);
    expectEmptyRaster(raster);
  });

  it.each([0, 0x80000000, 0xffffffff])(
    "accepts uint32 seed boundary %s",
    (seed) => {
      expect(create({ size: 4, color: COLOR, seed }).seed).toBe(seed);
    },
  );

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "rejects invalid configured seed and used stamp identity %s",
    (invalid) => {
      expect(() => create({ size: 4, color: COLOR, seed: invalid })).toThrow(
        `[${ErrorCodes.RANDOM.INVALID_UINT32}]`,
      );
      const brush = create({ size: 4, color: COLOR, jitter: { size: 0.2 } });
      expect(() =>
        brush.resolveParameters(stamp({ strokeSeed: invalid })),
      ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
      expect(() =>
        brush.resolveParameters(stamp({ stampIndex: invalid })),
      ).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
    },
  );

  it.each(["rotation", "size", "opacity", "spacing"])(
    "rejects invalid %s jitter amplitudes",
    (parameter) => {
      for (const invalid of [-1, -0.1, Number.NaN, Infinity, -Infinity]) {
        const construct = () =>
          create({ size: 4, color: COLOR, jitter: { [parameter]: invalid } });
        expect(construct).toThrow(ReverieRangeError);
        expect(construct).toThrow(
          `[${ErrorCodes.BRUSH.INVALID_JITTER_AMPLITUDE}]`,
        );
      }
    },
  );

  it("rejects malformed jitter objects and explicit null seed context", () => {
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => create({ size: 4, color: COLOR, jitter: null })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_JITTER_OBJECT}]`,
    );
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => create({ size: 4, color: COLOR, jitter: [] })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_JITTER_OBJECT}]`,
    );
    const brush = create({ size: 4, color: COLOR, jitter: { rotation: 0.2 } });
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => brush.resolveParameters(stamp({ strokeSeed: null }))).toThrow(
      `[${ErrorCodes.RANDOM.INVALID_UINT32}]`,
    );
  });

  it("rejects size and rotation arithmetic overflow before painting", () => {
    const sizeBrush = create({
      size: Number.MAX_VALUE,
      color: COLOR,
      jitter: { size: Number.MAX_VALUE },
    });
    const rotationBrush = create({
      size: 4,
      rotation: Number.MAX_VALUE,
      color: COLOR,
      jitter: { rotation: Number.MAX_VALUE },
    });
    for (const brush of [sizeBrush, rotationBrush]) {
      expect(() =>
        brush.resolveParameters(stamp({ strokeSeed: 0, stampIndex: 4 })),
      ).toThrow(`[${ErrorCodes.BRUSH.INVALID_JITTER_PARAMETERS}]`);
    }
  });

  it("resolves omitted input through neutral dynamics and fixed random defaults", () => {
    const brush = create({
      size: 4,
      opacity: 0.5,
      rotation: 0.25,
      seed: 0x80000000,
      color: COLOR,
      dynamics: {
        size: { pressure: { min: 0.2 } },
        opacity: { velocity: { min: 0.2, maxVelocity: 1 } },
        rotation: { direction: {}, tilt: {} },
      },
      jitter: { size: 0.2, opacity: 0.2, rotation: 0.5 },
    });
    expect(brush.resolveParameters()).toEqual(
      brush.resolveParameters(
        stamp({
          pressure: 1,
          velocity: 0,
          tiltX: 0,
          tiltY: 0,
          strokeSeed: brush.seed,
          stampIndex: 0,
        }),
      ),
    );
  });

  it.each(["size", "opacity"])(
    "skips geometry when dynamics alone resolves zero %s",
    (parameter) => {
      const brush = create({
        size: 4,
        color: COLOR,
        dynamics: { [parameter]: { pressure: { min: 0 } } },
      });
      const raster = new Raster();
      // The continuous position is finite, but visiting its pixel bounds would overflow.
      expect(() =>
        brush.stamp(
          raster,
          { x: Number.MAX_VALUE, y: 0 },
          stamp({ pressure: 0 }),
        ),
      ).not.toThrow();
      expectEmptyRaster(raster);
    },
  );

  it("does not use Math.random for resolved or painted variation", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Unexpected nondeterministic randomness");
    });
    try {
      const brush = create({
        size: 4,
        color: COLOR,
        jitter: { size: 0.2, opacity: 0.2, rotation: 0.2 },
      });
      brush.resolveParameters(stamp());
      brush.stamp(new Raster(), POSITION, stamp());
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});

/** Creates a hand-authored command while leaving legacy optional fields absent. */
function stamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return { position: POSITION, ...overrides };
}

/** Checks both observable transparency and the existing debug allocation contract. */
function expectEmptyRaster(raster: Raster): void {
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      expect(raster.getPixel({ x, y })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    }
  }
  // #if DEBUG
  expect(raster.allocatedTileCount).toBe(0);
  // #endif
}
