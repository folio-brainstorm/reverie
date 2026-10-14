import { describe, expect, it } from "vitest";

import { ErrorCodes, ReverieTypeError, SelectionMask } from "@reveriejs/core";
import type { SelectionSpanVisitor } from "@reveriejs/core";

describe("SelectionMask selected span traversal", () => {
  it.each([null, undefined, 0, {}])(
    "rejects an invalid visitor %# even for empty masks",
    (visitor) => {
      const mask = new SelectionMask();
      expect(() =>
        mask.forEachSelectedSpan(
          // @ts-expect-error Runtime validation protects JavaScript callers.
          visitor,
        ),
      ).toThrow(ReverieTypeError);
      expect(() =>
        mask.forEachSelectedSpan(
          // @ts-expect-error Runtime validation protects JavaScript callers.
          visitor,
        ),
      ).toThrow(`[${ErrorCodes.SELECTION.INVALID_SPAN_VISITOR}]`);
    },
  );
  it.each([1, 2, 3, 256])(
    "covers exactly the nonzero pixels across tile grid %s",
    (tileSize) => {
      const mask = SelectionMask.fromRect(
        { x: -3, y: -2, width: 7, height: 5 },
        { tileSize },
      );
      mask.setCoverage(-1, -1, 0);
      mask.setCoverage(1, 1, 0.5);
      const visited = new Set<string>();
      const visit: SelectionSpanVisitor = (minimumX, maximumX, y): void => {
        expect(minimumX).toBeLessThan(maximumX);
        for (let x = minimumX; x < maximumX; x += 1) {
          expect(visited.has(`${x}:${y}`)).toBe(false);
          visited.add(`${x}:${y}`);
        }
      };
      mask.forEachSelectedSpan(visit);
      for (let y = -3; y < 4; y += 1) {
        for (let x = -4; x < 5; x += 1) {
          expect(visited.has(`${x}:${y}`)).toBe(mask.getCoverage(x, y) > 0);
        }
      }
      expect(mask.getCoverage(1, 1)).toBe(128 / 255);
    },
  );

  it("visits sparse distant regions without scanning the space between them", () => {
    const mask = new SelectionMask({ tileSize: 2 });
    mask.setCoverage(0, 0, 1);
    mask.setCoverage(1_000_000_000, -1_000_000_000, 0.5);
    const spans: number[][] = [];
    mask.forEachSelectedSpan((start, end, y) => {
      spans.push([start, end, y]);
    });
    expect(spans).toHaveLength(2);
    expect(spans).toContainEqual([0, 1, 0]);
    expect(spans).toContainEqual([
      1_000_000_000, 1_000_000_001, -1_000_000_000,
    ]);
  });

  it("visits no spans for an empty selection", () => {
    const spans: number[][] = [];
    new SelectionMask().forEachSelectedSpan((start, end, y) => {
      spans.push([start, end, y]);
    });
    expect(spans).toEqual([]);
  });

  it("propagates visitor failures without changing stored coverage", () => {
    const mask = SelectionMask.fromRect({ x: 0, y: 0, width: 2, height: 2 });
    const failure = new Error("Visitor failure");
    expect(() =>
      mask.forEachSelectedSpan(() => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(mask.getCoverage(0, 0)).toBe(1);
  });

  it("retains span occupancy through opaque, fractional, and cleared tile transitions", () => {
    const mask = SelectionMask.fromRect(
      { x: 0, y: 0, width: 2, height: 2 },
      { tileSize: 2 },
    );
    mask.setCoverage(0, 0, 0.5);
    const source = SelectionMask.fromRect(
      { x: 0, y: 0, width: 2, height: 2 },
      { tileSize: 2 },
    );
    mask.intersect(source);
    expect(mask.getCoverage(0, 0)).toBe(128 / 255);
    const copy = new SelectionMask({ tileSize: 2 });
    copy.replace(mask);
    copy.setCoverage(1, 1, 0);
    const spans: number[][] = [];
    copy.forEachSelectedSpan((start, end, y) => {
      spans.push([start, end, y]);
    });
    expect(spans).toEqual([
      [0, 2, 0],
      [0, 1, 1],
    ]);
    mask.subtract(source);
    expect(mask.allocatedTileCount).toBe(0);
    expect(copy.getCoverage(0, 0)).toBe(128 / 255);
  });
});
