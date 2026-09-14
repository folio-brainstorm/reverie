import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  LinearDynamicsCurve,
  Raster,
  ReverieRangeError,
} from "@reverie/core";
import type {
  BrushDynamics,
  DynamicsCurve,
  RGBAColor,
  ResolvedBrushParameters,
  StampCommand,
} from "@reverie/core";

const OPAQUE_GREEN: RGBAColor = { r: 0, g: 255, b: 0, a: 255 };
const STAMP_POSITION = { x: 0.5, y: 0.5 };

describe("brush dynamics curves and parameter resolution", () => {
  it.each([0, 0.25, 0.5, 0.75, 1])(
    "evaluates the built-in linear curve at %s",
    (input) => {
      const curve: DynamicsCurve = new LinearDynamicsCurve();

      expect(curve.evaluate(input)).toBe(input);
    },
  );

  it.each([0, 0.25, 1])(
    "maps pressure to size with minimum ratio %s",
    (minimum) => {
      const brush = createBrush({
        size: { pressure: { min: minimum } },
      });

      for (const pressure of [0, 0.5, 1]) {
        const resolved = brush.resolveParameters(createStamp({ pressure }));
        const expectedFactor = minimum + (1 - minimum) * pressure;

        expect(resolved.size).toBeCloseTo(20 * expectedFactor);
        expect(resolved.opacity).toBe(0.8);
      }
    },
  );

  it.each([0, 0.25, 1])(
    "maps pressure to opacity with minimum ratio %s",
    (minimum) => {
      const brush = createBrush({
        opacity: { pressure: { min: minimum } },
      });

      for (const pressure of [0, 0.5, 1]) {
        const resolved = brush.resolveParameters(createStamp({ pressure }));
        const expectedFactor = minimum + (1 - minimum) * pressure;

        expect(resolved.size).toBe(20);
        expect(resolved.opacity).toBeCloseTo(0.8 * expectedFactor);
      }
    },
  );

  it("enables pressure mappings independently", () => {
    const sizeBrush = createBrush({ size: { pressure: { min: 0 } } });
    const opacityBrush = createBrush({ opacity: { pressure: { min: 0 } } });
    const input = createStamp({ pressure: 0.5 });

    expect(sizeBrush.resolveParameters(input)).toEqual({
      size: 10,
      opacity: 0.8,
      rotation: 0,
    });
    expect(opacityBrush.resolveParameters(input)).toEqual({
      size: 20,
      opacity: 0.4,
      rotation: 0,
    });
  });

  it("ignores velocity when no velocity mapping is configured", () => {
    const brush = createBrush({ size: { pressure: { min: 0 } } });
    const slow = brush.resolveParameters(
      createStamp({ pressure: 0.5, velocity: 0 }),
    );
    const fast = brush.resolveParameters(
      createStamp({ pressure: 0.5, velocity: 100 }),
    );

    expect(fast).toEqual(slow);
  });

  it("uses inverse normalized velocity for size and opacity", () => {
    const brush = createBrush({
      size: { velocity: { min: 0.25, maxVelocity: 1 } },
      opacity: { velocity: { min: 0.25, maxVelocity: 1 } },
    });

    expectResolved(brush.resolveParameters(createStamp({ velocity: 0 })), {
      size: 20,
      opacity: 0.8,
      rotation: 0,
    });
    expectResolved(brush.resolveParameters(createStamp({ velocity: 0.5 })), {
      size: 12.5,
      opacity: 0.5,
      rotation: 0,
    });
    expectResolved(brush.resolveParameters(createStamp({ velocity: 1 })), {
      size: 5,
      opacity: 0.2,
      rotation: 0,
    });
    expectResolved(brush.resolveParameters(createStamp({ velocity: 2 })), {
      size: 5,
      opacity: 0.2,
      rotation: 0,
    });
  });

  it("multiplies pressure and velocity factors", () => {
    const brush = createBrush({
      size: {
        pressure: { min: 0 },
        velocity: { min: 0, maxVelocity: 1 },
      },
    });

    expect(
      brush.resolveParameters(createStamp({ pressure: 0.8, velocity: 0.5 }))
        .size,
    ).toBeCloseTo(8);
  });

  it("leaves all base parameters unchanged when dynamics is absent", () => {
    const brush = createBrush();

    for (const pressure of [0, 0.5, 1]) {
      expect(
        brush.resolveParameters(createStamp({ pressure, velocity: pressure })),
      ).toEqual({ size: 20, opacity: 0.8, rotation: 0 });
    }
  });

  it("allows a custom curve to alter resolution without changing the pipeline", () => {
    const squaredCurve: DynamicsCurve = {
      evaluate(input): number {
        return input * input;
      },
    };
    const brush = createBrush({
      size: { pressure: { min: 0, curve: squaredCurve } },
    });

    expect(brush.resolveParameters(createStamp({ pressure: 0.5 })).size).toBe(
      5,
    );
  });
});

describe("tilt rotation dynamics", () => {
  it.each([
    [0, 0, 0],
    [45, 0, 0],
    [-45, 0, Math.PI],
    [0, 45, Math.PI / 2],
    [0, -45, -Math.PI / 2],
    [45, 45, Math.PI / 4],
    [-45, 45, (3 * Math.PI) / 4],
    [-45, -45, (-3 * Math.PI) / 4],
    [45, -45, -Math.PI / 4],
  ])(
    "resolves tilt (%s, %s) to %s radians",
    (tiltX, tiltY, expectedRotation) => {
      const brush = createBrush({ rotation: { tilt: {} } });

      expect(
        brush.resolveParameters(createStamp({ tiltX, tiltY })).rotation,
      ).toBeCloseTo(expectedRotation);
    },
  );

  it("keeps CircleBrush pixels rotation-invariant", () => {
    const brush = createBrush({ rotation: { tilt: {} } });
    const firstRaster = new Raster();
    const secondRaster = new Raster();

    brush.stamp(
      firstRaster,
      STAMP_POSITION,
      createStamp({ tiltX: 45, tiltY: 0 }),
    );
    brush.stamp(
      secondRaster,
      STAMP_POSITION,
      createStamp({ tiltX: -45, tiltY: 45 }),
    );

    for (let y = -10; y <= 10; y += 1) {
      for (let x = -10; x <= 10; x += 1) {
        expect(firstRaster.getPixel({ x, y })).toEqual(
          secondRaster.getPixel({ x, y }),
        );
      }
    }
  });
});

describe("CircleBrush dynamic painting", () => {
  it("uses resolved size in the existing circle rasterizer", () => {
    const brush = new CircleBrush({
      size: 4,
      color: OPAQUE_GREEN,
      dynamics: { size: { pressure: { min: 0 } } },
    });
    const smallRaster = new Raster();
    const baseRaster = new Raster();

    brush.stamp(smallRaster, STAMP_POSITION, createStamp({ pressure: 0.5 }));
    brush.stamp(baseRaster, STAMP_POSITION, createStamp({ pressure: 1 }));

    expect(smallRaster.getPixel({ x: 2, y: 0 }).a).toBe(0);
    expect(baseRaster.getPixel({ x: 2, y: 0 }).a).toBe(255);
  });

  it("treats zero resolved size as a paint no-op", () => {
    const brush = new CircleBrush({
      size: 4,
      color: OPAQUE_GREEN,
      dynamics: { size: { pressure: { min: 0 } } },
    });
    const raster = new Raster();

    brush.stamp(raster, STAMP_POSITION, createStamp({ pressure: 0 }));

    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it("feeds resolved opacity through the existing blend path", () => {
    const brush = new CircleBrush({
      size: 1,
      color: OPAQUE_GREEN,
      dynamics: { opacity: { pressure: { min: 0 } } },
    });
    const raster = new Raster();

    brush.stamp(raster, STAMP_POSITION, createStamp({ pressure: 0.5 }));

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_GREEN,
      a: 128,
    });
  });

  it("does not mutate base brush parameters while resolving stamps", () => {
    const brush = createBrush({
      size: { pressure: { min: 0.25 } },
      opacity: { velocity: { min: 0, maxVelocity: 1 } },
    });
    const raster = new Raster();

    const input = createStamp({ pressure: 0, velocity: 1 });
    const inputSnapshot = { ...input, position: { ...input.position } };

    brush.stamp(raster, STAMP_POSITION, input);

    expect(brush.size).toBe(20);
    expect(brush.opacity).toBe(0.8);
    expect(input).toEqual(inputSnapshot);
  });
});

describe("brush dynamics validation", () => {
  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minimum ratio %s",
    (min) => {
      const createInvalidBrush = () =>
        createBrush({ size: { pressure: { min } } });

      expect(createInvalidBrush).toThrow(ReverieRangeError);
      expect(createInvalidBrush).toThrow(
        `[${ErrorCodes.BRUSH.INVALID_DYNAMICS_MIN}]`,
      );
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maximum velocity %s",
    (maxVelocity) => {
      const createInvalidBrush = () =>
        createBrush({ size: { velocity: { maxVelocity } } });

      expect(createInvalidBrush).toThrow(ReverieRangeError);
      expect(createInvalidBrush).toThrow(
        `[${ErrorCodes.BRUSH.INVALID_MAX_VELOCITY}]`,
      );
    },
  );

  it("rejects a missing maximum velocity at runtime", () => {
    const createInvalidBrush = () =>
      createBrush({
        size: {
          // @ts-expect-error Runtime validation protects JavaScript callers.
          velocity: {},
        },
      });

    expect(createInvalidBrush).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_MAX_VELOCITY}]`,
    );
  });

  it("rejects malformed nested dynamics objects", () => {
    const createInvalidBrush = () =>
      new CircleBrush({
        size: 20,
        color: OPAQUE_GREEN,
        // @ts-expect-error Runtime validation protects JavaScript callers.
        dynamics: null,
      });

    expect(createInvalidBrush).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_DYNAMICS_OBJECT}]`,
    );
  });

  it("rejects a curve without an evaluate method", () => {
    const createInvalidBrush = () =>
      createBrush({
        size: {
          pressure: {
            // @ts-expect-error Runtime validation protects JavaScript callers.
            curve: {},
          },
        },
      });

    expect(createInvalidBrush).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_DYNAMICS_CURVE}]`,
    );
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid curve output %s",
    (output) => {
      const brush = createBrush({
        size: {
          pressure: {
            curve: { evaluate: () => output },
          },
        },
      });
      const resolve = () =>
        brush.resolveParameters(createStamp({ pressure: 0.5 }));

      expect(resolve).toThrow(ReverieRangeError);
      expect(resolve).toThrow(
        `[${ErrorCodes.BRUSH.INVALID_DYNAMICS_CURVE_OUTPUT}]`,
      );
    },
  );

  it("rejects invalid pressure used by an enabled mapping", () => {
    const brush = createBrush({ size: { pressure: { min: 0 } } });
    const resolve = () =>
      brush.resolveParameters(createStamp({ pressure: -1 }));

    expect(resolve).toThrow(`[${ErrorCodes.BRUSH.INVALID_DYNAMICS_INPUT}]`);
  });

  it("rejects invalid velocity used by an enabled mapping", () => {
    const brush = createBrush({
      size: { velocity: { min: 0, maxVelocity: 1 } },
    });
    const resolve = () =>
      brush.resolveParameters(createStamp({ velocity: -1 }));

    expect(resolve).toThrow(`[${ErrorCodes.BRUSH.INVALID_DYNAMICS_INPUT}]`);
  });

  it("rejects invalid tilt used by an enabled mapping", () => {
    const brush = createBrush({ rotation: { tilt: {} } });
    const resolve = () => brush.resolveParameters(createStamp({ tiltX: 100 }));

    expect(resolve).toThrow(`[${ErrorCodes.BRUSH.INVALID_DYNAMICS_INPUT}]`);
  });
});

/** Creates a standard CircleBrush with optional dynamics under test. */
function createBrush(dynamics?: BrushDynamics): CircleBrush {
  return new CircleBrush({
    size: 20,
    opacity: 0.8,
    spacing: 0.25,
    color: OPAQUE_GREEN,
    ...(dynamics === undefined ? {} : { dynamics }),
  });
}

/** Creates one hand-authored stamp with neutral defaults and selected overrides. */
function createStamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return {
    position: STAMP_POSITION,
    timestamp: 0,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    velocity: 0,
    ...overrides,
  };
}

/** Compares every resolved scalar within floating-point tolerance. */
function expectResolved(
  actual: ResolvedBrushParameters,
  expected: ResolvedBrushParameters,
): void {
  expect(actual.size).toBeCloseTo(expected.size);
  expect(actual.opacity).toBeCloseTo(expected.opacity);
  expect(actual.rotation).toBeCloseTo(expected.rotation);
}
