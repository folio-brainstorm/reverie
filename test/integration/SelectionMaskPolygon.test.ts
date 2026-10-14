import { describe, expect, it } from "vitest";

import {
  ErrorCodes,
  PixelBrush,
  ReverieRangeError,
  SelectionMask,
  World,
} from "@reveriejs/core";
import type { WorldPoint } from "@reveriejs/core";

const TRIANGLE: readonly WorldPoint[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 4 },
];

describe("SelectionMask polygon construction", () => {
  it("retains a shallow crossing whose endpoints straddle a center below translation precision", () => {
    const mask = SelectionMask.fromPolygon([
      { x: 0, y: -1 },
      { x: 20, y: 0.5 - Number.EPSILON / 4 },
      { x: 40, y: 0.5 + Number.EPSILON / 2 },
      { x: 40, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(mask.getCoverage(26, 0)).toBe(1);
    expect(mask.getCoverage(27, 0)).toBe(0);
  });
  it.each([19, 23, 31, 57])(
    "excludes every center on the right diagonal of an integer triangle of size %s",
    (size) => {
      const points = [
        { x: 0, y: 0 },
        { x: size, y: size },
        { x: 0, y: size },
      ];
      for (const tileSize of [2, 7, 256]) {
        for (const vertices of [points, [...points].reverse()]) {
          const mask = SelectionMask.fromPolygon(vertices, { tileSize });
          for (let index = 0; index < size; index += 1) {
            expect(mask.getCoverage(index, index)).toBe(0);
            if (index > 0) expect(mask.getCoverage(index - 1, index)).toBe(1);
          }
        }
      }
    },
  );

  it.each([-1, 1])(
    "preserves an actual subpixel offset on side %s of a diagonal",
    (side) => {
      for (const offset of [1e-12, Number.EPSILON * 19]) {
        const mask = SelectionMask.fromPolygon([
          { x: 0, y: 0 },
          { x: 19 + side * offset, y: 19 },
          { x: 0, y: 19 },
        ]);
        expect(mask.getCoverage(10, 10)).toBe(side > 0 ? 1 : 0);
      }
    },
  );

  it("samples pixel centers with left-inclusive and right-exclusive edges", () => {
    const selection = SelectionMask.fromPolygon(TRIANGLE);

    expect(readRows(selection, 0, 0, 4, 4)).toEqual([
      "###.",
      "##..",
      "#...",
      "....",
    ]);
  });

  it("uses the even-odd rule for self-crossing paths", () => {
    const selection = SelectionMask.fromPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 4, y: 0 },
    ]);

    expect(readRows(selection, 0, 0, 4, 4)).toEqual([
      "###.",
      ".#..",
      ".#..",
      "###.",
    ]);
  });

  it("fills concave geometry without filling its notch", () => {
    const selection = SelectionMask.fromPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ]);

    expect(readRows(selection, 0, 0, 4, 4)).toEqual([
      "####",
      "#...",
      "#...",
      "#...",
    ]);
  });

  it("includes lower endpoint centers and excludes upper endpoint centers", () => {
    const selection = SelectionMask.fromPolygon([
      { x: -0.5, y: -0.5 },
      { x: 1.5, y: -0.5 },
      { x: 1.5, y: 1.5 },
      { x: -0.5, y: 1.5 },
    ]);

    expect(readRows(selection, -1, -1, 3, 3)).toEqual(["##.", "##.", "..."]);
  });

  it.each([1, 2, 3, 4, 256])(
    "matches half-open rectangular coverage with tile size %s",
    (tileSize) => {
      const rect = { x: -3, y: -2, width: 7, height: 5 };
      const polygon = SelectionMask.fromPolygon(
        [
          { x: -3, y: -2 },
          { x: 4, y: -2 },
          { x: 4, y: 3 },
          { x: -3, y: 3 },
        ],
        { tileSize },
      );
      const rectangle = SelectionMask.fromRect(rect, { tileSize });

      expect(readRows(polygon, -4, -3, 9, 7)).toEqual(
        readRows(rectangle, -4, -3, 9, 7),
      );
      expect(polygon.allocatedTileCount).toBe(rectangle.allocatedTileCount);
    },
  );

  it("is invariant under winding, starting vertex, and repeated closure", () => {
    const points = [
      { x: -2.2, y: -1.5 },
      { x: 3.3, y: 0.5 },
      { x: 0.5, y: 3.25 },
      { x: -1.5, y: 1.5 },
    ];
    const expected = readRows(SelectionMask.fromPolygon(points), -3, -2, 8, 7);
    const variants = [
      [...points].reverse(),
      [...points.slice(2), ...points.slice(0, 2)],
      [...points, ...points.slice(0, 1)],
      points.flatMap((point) => [point, point]),
    ];

    for (const variant of variants) {
      expect(
        readRows(SelectionMask.fromPolygon(variant), -3, -2, 8, 7),
      ).toEqual(expected);
    }
  });

  it("does not mutate or retain input geometry as authoritative selection state", () => {
    const points = TRIANGLE.map((point) => ({ ...point }));
    const original = points.map((point) => ({ ...point }));
    const selection = SelectionMask.fromPolygon(points);
    expect(points).toEqual(original);

    points.splice(0, points.length);
    selection.setCoverage(3, 3, 0.5);

    expect(selection.getCoverage(0, 0)).toBe(1);
    expect(selection.getCoverage(3, 3)).toBe(128 / 255);
  });

  it.each(
    [
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: -2, y: -2 },
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0, y: 0.1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: Number.MAX_SAFE_INTEGER },
      ],
    ].map((points) => ({ points })),
  )(
    "returns an unallocated empty mask for uncovered paths %#",
    ({ points }) => {
      const selection = SelectionMask.fromPolygon(points, { tileSize: 2 });

      expect(selection.allocatedTileCount).toBe(0);
      expect(selection.getCoverage(0, 0)).toBe(0);
    },
  );

  it("allocates only tiles containing polygon coverage", () => {
    const selection = SelectionMask.fromPolygon(
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
      ],
      { tileSize: 2 },
    );

    expect(selection.allocatedTileCount).toBe(10);
    expect(selection.getCoverage(7, 7)).toBe(0);
  });

  it.each([Number.MAX_SAFE_INTEGER - 4, Number.MIN_SAFE_INTEGER])(
    "preserves pixel-center sampling near safe coordinate limit %s",
    (origin) => {
      const selection = SelectionMask.fromPolygon(
        TRIANGLE.map(({ x, y }) => ({ x: origin + x, y: origin + y })),
        { tileSize: 1 },
      );

      expect(readRows(selection, origin, origin, 4, 4)).toEqual([
        "###.",
        "##..",
        "#...",
        "....",
      ]);
    },
  );

  it.each(
    [
      null,
      {},
      [],
      [{ x: 0, y: 0 }],
      new Array(3),
      [
        { x: 0, y: 0 },
        { x: "1", y: 0 },
        { x: 0, y: 1 },
      ],
      [{ x: 0, y: 0 }, null, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1 }, { x: 0, y: 1 }],
    ].map((points) => ({ points })),
  )("rejects malformed polygon input %# with a stable error", ({ points }) => {
    expect(() =>
      SelectionMask.fromPolygon(
        // @ts-expect-error Runtime validation protects JavaScript callers.
        points,
      ),
    ).toThrow(`[${ErrorCodes.SELECTION.INVALID_POLYGON}]`);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects nonfinite polygon coordinate %s",
    (coordinate) => {
      expect(() =>
        SelectionMask.fromPolygon([
          { x: 0, y: 0 },
          { x: coordinate, y: 0 },
          { x: 0, y: 1 },
        ]),
      ).toThrow(ReverieRangeError);
      expect(() =>
        SelectionMask.fromPolygon([
          { x: 0, y: 0 },
          { x: 1, y: coordinate },
          { x: 0, y: 1 },
        ]),
      ).toThrow(`[${ErrorCodes.SELECTION.INVALID_POLYGON}]`);
    },
  );

  it.each(
    [
      [
        { x: 0, y: 0 },
        { x: Number.MAX_VALUE, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: Number.MIN_SAFE_INTEGER, y: 0 },
        { x: Number.MAX_SAFE_INTEGER, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 100_000_000, y: 0 },
        { x: 0, y: 100_000_000 },
      ],
    ].map((points) => ({ points })),
  )("rejects unsafe polygon bounds before iteration %#", ({ points }) => {
    expect(() => SelectionMask.fromPolygon(points)).toThrow(
      `[${ErrorCodes.SELECTION.UNSAFE_POLYGON_BOUNDS}]`,
    );
  });

  it("validates the tile configuration for polygon construction", () => {
    expect(() => SelectionMask.fromPolygon(TRIANGLE, { tileSize: 0 })).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_TILE_SIZE}]`,
    );
  });
});

describe("Polygon selection World clipping", () => {
  it.each([true, false])(
    "clips paint and erase across layers with bounded World = %s",
    (isBounded) => {
      const world = new World({
        tileSize: 2,
        ...(isBounded ? { bounds: { x: 0, y: 0, width: 2, height: 2 } } : {}),
      });
      const selection = SelectionMask.fromPolygon(
        [
          { x: -2, y: -2 },
          { x: 5, y: -2 },
          { x: -2, y: 5 },
        ],
        { tileSize: 3 },
      );
      const color = { r: 20, g: 80, b: 240, a: 255 };
      const brush = new PixelBrush({ size: 5, color });
      const layers = [world.getLayer(0), world.addLayer()];

      for (const layer of layers) {
        layer.stamp(brush, { x: 0.5, y: 0.5 }, undefined, selection);
        for (let y = -2; y < 3; y += 1) {
          for (let x = -2; x < 3; x += 1) {
            const isInBounds =
              !isBounded || (x >= 0 && x < 2 && y >= 0 && y < 2);
            expect(layer.raster.getPixel({ x, y }).a).toBe(
              isInBounds ? selection.getCoverage(x, y) * 255 : 0,
            );
          }
        }
        layer.stamp(
          brush,
          { x: 0.5, y: 0.5 },
          { position: { x: 0.5, y: 0.5 }, paintMode: "erase" },
          selection,
        );
        for (let y = -2; y < 3; y += 1) {
          for (let x = -2; x < 3; x += 1) {
            expect(layer.raster.getPixel({ x, y }).a).toBe(0);
          }
        }
      }
    },
  );
});

/** Reads exact hard-edge coverage rows without relying on stored geometry. */
function readRows(
  selection: SelectionMask,
  originX: number,
  originY: number,
  width: number,
  height: number,
): string[] {
  return Array.from({ length: height }, (_, localY) =>
    Array.from({ length: width }, (_, localX) => {
      const coverage = selection.getCoverage(
        originX + localX,
        originY + localY,
      );
      expect([0, 1]).toContain(coverage);
      return coverage === 1 ? "#" : ".";
    }).join(""),
  );
}
