import { describe, expect, it, vi } from "vitest";

import {
  ErrorCodes,
  Rasterizers,
  ReverieRangeError,
  ReverieTypeError,
} from "@reverie/core";
import type {
  Circle,
  PixelCoverage,
  PixelCoverageVisitor,
} from "@reverie/core";

function collectHits(circle: Circle): PixelCoverage[] {
  const hits: PixelCoverage[] = [];

  Rasterizers.rasterizeCircle(circle, (hit) => hits.push(hit));

  return hits;
}

describe("circle rasterization", () => {
  it("is available with its contracts through the public package entry point", () => {
    const circle: Circle = { center: { x: 0.5, y: 0.5 }, radius: 0 };
    const visitor: PixelCoverageVisitor = vi.fn();

    Rasterizers.rasterizeCircle(circle, visitor);

    expect(visitor).toHaveBeenCalledOnce();
    expect(visitor).toHaveBeenCalledWith({
      pixel: { x: 0, y: 0 },
      coverage: 1,
    });
  });

  it("emits the pixel containing a zero-radius circle at its exact center", () => {
    expect(collectHits({ center: { x: 0.5, y: 0.5 }, radius: 0 })).toEqual([
      { pixel: { x: 0, y: 0 }, coverage: 1 },
    ]);
  });

  it("emits no pixels for a zero-radius circle away from every pixel center", () => {
    expect(collectHits({ center: { x: 0, y: 0 }, radius: 0 })).toEqual([]);
  });

  it("emits only the center pixel for radius 0.5", () => {
    expect(collectHits({ center: { x: 0.5, y: 0.5 }, radius: 0.5 })).toEqual([
      { pixel: { x: 0, y: 0 }, coverage: 1 },
    ]);
  });

  it("includes pixel centers exactly on a radius-one boundary", () => {
    const hits = collectHits({ center: { x: 0.5, y: 0.5 }, radius: 1 });

    expect(hits).toEqual([
      { pixel: { x: 0, y: -1 }, coverage: 1 },
      { pixel: { x: -1, y: 0 }, coverage: 1 },
      { pixel: { x: 0, y: 0 }, coverage: 1 },
      { pixel: { x: 1, y: 0 }, coverage: 1 },
      { pixel: { x: 0, y: 1 }, coverage: 1 },
    ]);
  });

  it("supports fractional circles spanning negative pixel coordinates", () => {
    expect(
      collectHits({ center: { x: -0.25, y: -0.25 }, radius: 0.4 }),
    ).toEqual([{ pixel: { x: -1, y: -1 }, coverage: 1 }]);
  });

  it("translates every hit by the same integer displacement as the circle", () => {
    const originalHits = collectHits({
      center: { x: 10.5, y: 20.5 },
      radius: 1,
    });
    const translatedHits = collectHits({
      center: { x: 110.5, y: -29.5 },
      radius: 1,
    });

    expect(translatedHits).toEqual(
      originalHits.map(({ pixel, coverage }) => ({
        pixel: { x: pixel.x + 100, y: pixel.y - 50 },
        coverage,
      })),
    );
  });

  it("visits every hit exactly once with binary coverage", () => {
    const visitor = vi.fn<PixelCoverageVisitor>();

    Rasterizers.rasterizeCircle({ center: { x: 0.5, y: 0.5 }, radius: 2 }, visitor);

    const hits = visitor.mock.calls.map(([hit]) => hit);
    const coordinates = hits.map(({ pixel }) => `${pixel.x},${pixel.y}`);

    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(hits.every(({ coverage }) => coverage === 1)).toBe(true);
  });
});

describe("circle rasterizer input validation", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid radius %s",
    (radius) => {
      const rasterize = () =>
        Rasterizers.rasterizeCircle({ center: { x: 0.5, y: 0.5 }, radius }, vi.fn());

      expect(rasterize).toThrow(ReverieRangeError);
      expect(rasterize).toThrow(`[${ErrorCodes.COMMON.INVALID_CIRCLE_RADIUS}]`);
    },
  );

  it("rejects a non-number radius at runtime", () => {
    const rasterize = () =>
      Rasterizers.rasterizeCircle(
        {
          center: { x: 0.5, y: 0.5 },
          // @ts-expect-error Runtime validation protects JavaScript callers.
          radius: "1",
        },
        vi.fn(),
      );

    expect(rasterize).toThrow(ReverieRangeError);
    expect(rasterize).toThrow(`[${ErrorCodes.COMMON.INVALID_CIRCLE_RADIUS}]`);
  });

  it.each([
    { x: Number.NaN, y: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0 },
    { x: 0, y: Number.NEGATIVE_INFINITY },
  ])("rejects non-finite center %#", (center) => {
    const rasterize = () => Rasterizers.rasterizeCircle({ center, radius: 1 }, vi.fn());

    expect(rasterize).toThrow(ReverieRangeError);
    expect(rasterize).toThrow(`[${ErrorCodes.COMMON.INVALID_CIRCLE_CENTER}]`);
  });

  it("rejects a non-number center component at runtime", () => {
    const rasterize = () =>
      Rasterizers.rasterizeCircle(
        {
          center: {
            // @ts-expect-error Runtime validation protects JavaScript callers.
            x: "0.5",
            y: 0.5,
          },
          radius: 1,
        },
        vi.fn(),
      );

    expect(rasterize).toThrow(ReverieTypeError);
    expect(rasterize).toThrow(`[${ErrorCodes.COMMON.INVALID_COORDINATE_TYPE}]`);
  });

  it("rejects candidate pixel bounds outside the safe integer range", () => {
    const rasterize = () =>
      Rasterizers.rasterizeCircle(
        { center: { x: Number.MAX_SAFE_INTEGER + 1, y: 0.5 }, radius: 0 },
        vi.fn(),
      );

    expect(rasterize).toThrow(ReverieRangeError);
    expect(rasterize).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_CIRCLE_PIXEL_BOUNDS}]`,
    );
  });
});
