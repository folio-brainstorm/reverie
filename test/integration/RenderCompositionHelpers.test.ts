import { describe, expect, it } from "vitest";

import { blendSourceOver, CircleBrush, Raster, World } from "@reverie/core";
import {
  compositeRgbaSourceOverInPlace,
  intersectRenderRegion,
  resolveRenderSource,
} from "@reverie/core/renderer";

describe("shared render-source resolution", () => {
  it("captures immutable dependencies without freezing or retaining caller config", () => {
    const raster = new Raster();
    const config = { raster };
    const snapshot = resolveRenderSource(
      config,
      () => new Error("invalid source"),
    );
    config.raster = new Raster();
    expect(snapshot.raster).toBe(raster);
    expect(snapshot.world).toBeUndefined();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(config)).toBe(false);
  });

  it("preserves the supplied World reference", () => {
    const world = new World();
    const snapshot = resolveRenderSource(
      { world },
      () => new Error("invalid source"),
    );
    expect(snapshot.world).toBe(world);
    expect(snapshot.raster).toBeUndefined();
  });

  it("uses the caller's error instance for invalid source combinations", () => {
    const failure = new TypeError("invalid source");
    // @ts-expect-error Missing source deliberately tests untyped callers.
    expect(() => resolveRenderSource({}, () => failure)).toThrow(failure);
    expect(() => {
      const conflicting = { raster: new Raster(), world: new World() };
      // @ts-expect-error Conflicting sources deliberately test untyped callers.
      resolveRenderSource(conflicting, () => failure);
    }).toThrow(failure);
  });
});

describe("half-open render-region intersection", () => {
  it.each([
    {
      region: { x: -2, y: -2, width: 4, height: 4 },
      expected: { x: -1, y: -1, width: 2, height: 2 },
    },
    {
      region: { x: -0.5, y: 0, width: 1, height: 0.5 },
      expected: { x: -0.5, y: 0, width: 1, height: 0.5 },
    },
    { region: { x: 1, y: 0, width: 1, height: 1 }, expected: null },
    { region: { x: -2, y: 0, width: 1, height: 1 }, expected: null },
    { region: { x: 0, y: 1, width: 1, height: 1 }, expected: null },
    { region: { x: 0, y: -2, width: 1, height: 1 }, expected: null },
    { region: { x: 0, y: 0, width: 0, height: 1 }, expected: null },
    { region: { x: 0, y: 0, width: 1, height: 0 }, expected: null },
  ])(
    "intersects continuous or empty region $region",
    ({ region, expected }) => {
      expect(
        intersectRenderRegion(region, { x: -1, y: -1, width: 2, height: 2 }),
      ).toEqual(expected);
    },
  );

  it("returns an independent rectangle for an unbounded document", () => {
    const region = { x: -3, y: 0, width: 2, height: 1 };
    expect(intersectRenderRegion(region, null)).toEqual(region);
    expect(intersectRenderRegion(region, null)).not.toBe(region);
  });
});

describe("consistent byte-level Source Over", () => {
  it("agrees across public colors, brush raster writes and bulk composition", () => {
    const alphas = [0, 1, 64, 127, 128, 200, 254, 255];
    for (const sourceAlpha of alphas) {
      for (const destinationAlpha of alphas) {
        const source = { r: 201, g: 17, b: 93, a: sourceAlpha };
        const destination = { r: 31, g: 199, b: 237, a: destinationAlpha };
        const expected = blendSourceOver(source, destination);
        const raster = new Raster({ tileSize: 2 });
        raster.setPixel({ x: 0, y: 0 }, destination);
        new CircleBrush({ size: 1, color: source }).stamp(raster, {
          x: 0.5,
          y: 0.5,
        });
        expect(raster.getPixel({ x: 0, y: 0 })).toEqual(expected);
        const pixels = new Uint8ClampedArray([
          destination.r,
          destination.g,
          destination.b,
          destination.a,
        ]);
        compositeRgbaSourceOverInPlace(
          new Uint8ClampedArray([source.r, source.g, source.b, source.a]),
          0,
          pixels,
          0,
          1,
        );
        expect(Array.from(pixels)).toEqual([
          expected.r,
          expected.g,
          expected.b,
          expected.a,
        ]);
      }
    }
  });

  it.each([
    {
      source: [200, 100, 50, 255],
      destination: [10, 20, 30, 255],
      opacity: 0,
      expected: [10, 20, 30, 255],
    },
    {
      source: [200, 100, 50, 255],
      destination: [10, 20, 30, 255],
      opacity: 1,
      expected: [200, 100, 50, 255],
    },
    {
      source: [200, 100, 50, 255],
      destination: [10, 20, 30, 255],
      opacity: 0.5,
      expected: [105, 60, 40, 255],
    },
    {
      source: [200, 100, 50, 128],
      destination: [10, 20, 30, 0],
      opacity: 0.5,
      expected: [200, 100, 50, 64],
    },
    {
      source: [200, 100, 50, 0],
      destination: [10, 20, 30, 0],
      opacity: 1,
      expected: [10, 20, 30, 0],
    },
  ])(
    "honors fast-path opacity and offsets ($opacity)",
    ({ source, destination, opacity, expected }) => {
      const input = new Uint8ClampedArray([9, 8, 7, 6, ...source, 5]);
      const output = new Uint8ClampedArray([1, 2, 3, 4, ...destination, 5]);
      compositeRgbaSourceOverInPlace(input, 4, output, 4, opacity);
      expect(Array.from(output)).toEqual([1, 2, 3, 4, ...expected, 5]);
      expect(Array.from(input)).toEqual([9, 8, 7, 6, ...source, 5]);
    },
  );

  it.each([
    ["multiply", [8, 8, 6]],
    ["screen", [202, 112, 74]],
    ["overlay", [16, 16, 12]],
    ["darken", [10, 20, 30]],
    ["lighten", [200, 100, 50]],
    ["add", [210, 120, 80]],
  ] as const)("composes %s RGB before Source Over", (mode, expected) => {
    const output = new Uint8ClampedArray([10, 20, 30, 255]);
    compositeRgbaSourceOverInPlace(
      new Uint8ClampedArray([200, 100, 50, 255]),
      0,
      output,
      0,
      1,
      mode,
    );
    expect(Array.from(output)).toEqual([...expected, 255]);
  });

  it("uses source RGB when a custom-mode destination is fully transparent", () => {
    const output = new Uint8ClampedArray([250, 240, 230, 0]);
    compositeRgbaSourceOverInPlace(
      new Uint8ClampedArray([200, 100, 50, 255]),
      0,
      output,
      0,
      1,
      "multiply",
    );
    expect(Array.from(output)).toEqual([200, 100, 50, 255]);
  });

  it("interpolates custom blend RGB by a partially transparent backdrop", () => {
    const output = new Uint8ClampedArray([100, 80, 60, 128]);
    compositeRgbaSourceOverInPlace(
      new Uint8ClampedArray([200, 100, 50, 255]),
      0,
      output,
      0,
      1,
      "multiply",
    );
    expect(Array.from(output)).toEqual([139, 65, 31, 255]);
  });
});
