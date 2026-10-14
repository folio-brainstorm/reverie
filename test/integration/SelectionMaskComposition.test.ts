import { describe, expect, it } from "vitest";

import {
  ErrorCodes,
  PixelBrush,
  ReverieTypeError,
  SelectionMask,
  World,
} from "@reveriejs/core";

describe("SelectionMask coverage composition", () => {
  it.each([
    {
      receiver: [255, 255, 255, 255],
      source: [255, 255, 255, 255],
      replace: [255, 255, 255, 255],
      add: [255, 255, 255, 255],
      subtract: [0, 0, 0, 0],
      intersect: [255, 255, 255, 255],
    },
    {
      receiver: [255, 255, 255, 255],
      source: [128, 255, 255, 0],
      replace: [128, 255, 255, 0],
      add: [255, 255, 255, 255],
      subtract: [127, 0, 0, 255],
      intersect: [128, 255, 255, 0],
    },
    {
      receiver: [64, 255, 255, 0],
      source: [255, 255, 255, 255],
      replace: [255, 255, 255, 255],
      add: [255, 255, 255, 255],
      subtract: [0, 0, 0, 0],
      intersect: [64, 255, 255, 0],
    },
    {
      receiver: [64, 255, 255, 0],
      source: [128, 255, 255, 0],
      replace: [128, 255, 255, 0],
      add: [128, 255, 255, 0],
      subtract: [32, 0, 0, 0],
      intersect: [64, 255, 255, 0],
    },
  ])(
    "composes full and partial aligned tiles without sharing coverage %#",
    (scenario) => {
      for (const operation of [
        "replace",
        "add",
        "subtract",
        "intersect",
      ] as const) {
        const receiver = new SelectionMask({ tileSize: 2 });
        const source = new SelectionMask({ tileSize: 2 });
        for (let index = 0; index < 4; index += 1) {
          receiver.setCoverage(
            index % 2,
            Math.floor(index / 2),
            (scenario.receiver[index] ?? 0) / 255,
          );
          source.setCoverage(
            index % 2,
            Math.floor(index / 2),
            (scenario.source[index] ?? 0) / 255,
          );
        }
        receiver[operation](source);
        const result = Array.from({ length: 4 }, (_, index) =>
          receiver.getCoverage(index % 2, Math.floor(index / 2)),
        );
        expect(result).toEqual(scenario[operation].map((byte) => byte / 255));
        expect(receiver.allocatedTileCount).toBe(
          scenario[operation].some((byte) => byte > 0) ? 1 : 0,
        );
        source.setCoverage(0, 0, 0);
        expect(receiver.getCoverage(0, 0)).toBe(
          (scenario[operation][0] ?? 0) / 255,
        );
        receiver.setCoverage(1, 0, 0);
        expect(source.getCoverage(1, 0)).toBe(1);
      }
    },
  );
  it.each([
    { receiverByte: 0, sourceByte: 0, add: 0, subtract: 0, intersect: 0 },
    { receiverByte: 0, sourceByte: 255, add: 255, subtract: 0, intersect: 0 },
    { receiverByte: 255, sourceByte: 0, add: 255, subtract: 255, intersect: 0 },
    {
      receiverByte: 255,
      sourceByte: 255,
      add: 255,
      subtract: 0,
      intersect: 255,
    },
    {
      receiverByte: 128,
      sourceByte: 64,
      add: 128,
      subtract: 96,
      intersect: 64,
    },
    {
      receiverByte: 64,
      sourceByte: 128,
      add: 128,
      subtract: 32,
      intersect: 64,
    },
    { receiverByte: 1, sourceByte: 127, add: 127, subtract: 1, intersect: 1 },
    { receiverByte: 1, sourceByte: 128, add: 128, subtract: 0, intersect: 1 },
  ])("composes byte coverage $receiverByte with $sourceByte", (scenario) => {
    for (const sourceTileSize of [2, 3]) {
      const source = new SelectionMask({ tileSize: sourceTileSize });
      source.setCoverage(-1, 2, scenario.sourceByte / 255);
      for (const operation of [
        "replace",
        "add",
        "subtract",
        "intersect",
      ] as const) {
        const receiver = new SelectionMask({ tileSize: 2 });
        receiver.setCoverage(-1, 2, scenario.receiverByte / 255);
        expect(receiver[operation](source)).toBeUndefined();
        const expected =
          operation === "replace" ? scenario.sourceByte : scenario[operation];
        expect(receiver.getCoverage(-1, 2)).toBe(expected / 255);
        expect(receiver.tileSize).toBe(2);
        expect(receiver.allocatedTileCount).toBe(expected === 0 ? 0 : 1);
        expect(source.getCoverage(-1, 2)).toBe(scenario.sourceByte / 255);
      }
    }
  });

  it.each(["replace", "add", "subtract", "intersect"] as const)(
    "%s operates on overlapping and disjoint sparse regions with different tile sizes",
    (operation) => {
      const receiver = new SelectionMask({ tileSize: 2 });
      receiver.setCoverage(-3, -3, 1);
      receiver.setCoverage(-1, -1, 128 / 255);
      receiver.setCoverage(0, 0, 64 / 255);
      const source = new SelectionMask({ tileSize: 3 });
      source.setCoverage(-1, -1, 64 / 255);
      source.setCoverage(0, 0, 128 / 255);
      source.setCoverage(1_000_000_000, -1_000_000_000, 1);

      receiver[operation](source);

      const expected = {
        replace: [0, 64, 128, 255],
        add: [255, 128, 128, 255],
        subtract: [255, 96, 32, 0],
        intersect: [0, 64, 64, 0],
      }[operation];
      expect([
        receiver.getCoverage(-3, -3),
        receiver.getCoverage(-1, -1),
        receiver.getCoverage(0, 0),
        receiver.getCoverage(1_000_000_000, -1_000_000_000),
      ]).toEqual(expected.map((byte) => byte / 255));
      expect(receiver.getCoverage(500_000_000, -500_000_000)).toBe(0);
      const expectedTileCount = {
        replace: 3,
        add: 4,
        subtract: 3,
        intersect: 2,
      }[operation];
      expect(receiver.allocatedTileCount).toBe(expectedTileCount);
      expect(source.allocatedTileCount).toBe(3);
      expect(source.getCoverage(-1, -1)).toBe(64 / 255);
      expect(source.getCoverage(0, 0)).toBe(128 / 255);
      expect(source.getCoverage(1_000_000_000, -1_000_000_000)).toBe(1);
    },
  );

  it.each(["replace", "add", "intersect"] as const)(
    "%s with itself preserves fractional coverage and allocated tiles",
    (operation) => {
      const selection = new SelectionMask({ tileSize: 2 });
      selection.setCoverage(-1, -1, 128 / 255);
      selection.setCoverage(0, 0, 1);

      selection[operation](selection);

      expect(selection.getCoverage(-1, -1)).toBe(128 / 255);
      expect(selection.getCoverage(0, 0)).toBe(1);
      expect(selection.allocatedTileCount).toBe(2);
    },
  );

  it("subtracts itself using pre-write coverage and releases empty tiles", () => {
    const selection = new SelectionMask({ tileSize: 2 });
    selection.setCoverage(-2, -2, 128 / 255);
    selection.setCoverage(-1, -2, 64 / 255);
    selection.setCoverage(0, 0, 1);
    selection.setCoverage(2, 2, 1);

    selection.subtract(selection);

    expect(selection.getCoverage(-2, -2)).toBe(64 / 255);
    expect(selection.getCoverage(-1, -2)).toBe(48 / 255);
    expect(selection.getCoverage(0, 0)).toBe(0);
    expect(selection.getCoverage(2, 2)).toBe(0);
    expect(selection.allocatedTileCount).toBe(1);
  });

  it.each(["replace", "add", "subtract", "intersect"] as const)(
    "%s handles empty operands and receiver",
    (operation) => {
      const selection = SelectionMask.fromRect(
        { x: -2, y: -2, width: 4, height: 4 },
        { tileSize: 2 },
      );
      const empty = new SelectionMask({ tileSize: 3 });
      selection[operation](empty);
      const shouldClear = operation === "replace" || operation === "intersect";
      expect(selection.allocatedTileCount).toBe(shouldClear ? 0 : 4);
      const source = SelectionMask.fromRect(
        { x: -2, y: -2, width: 4, height: 4 },
        { tileSize: 2 },
      );
      empty[operation](source);
      const shouldCopyIntoEmpty =
        operation === "replace" || operation === "add";
      expect(empty.getCoverage(0, 0)).toBe(shouldCopyIntoEmpty ? 1 : 0);
      expect(source.allocatedTileCount).toBe(4);
    },
  );

  it.each(["replace", "add"] as const)(
    "%s copies source coverage without sharing mutable tiles",
    (operation) => {
      const receiver = new SelectionMask({ tileSize: 2 });
      const source = SelectionMask.fromRect(
        { x: 0, y: 0, width: 2, height: 2 },
        { tileSize: 2 },
      );
      receiver[operation](source);
      receiver.setCoverage(0, 0, 0);
      expect(source.getCoverage(0, 0)).toBe(1);
      source.clear();
      expect(receiver.getCoverage(1, 1)).toBe(1);
    },
  );

  it.each(["replace", "add", "subtract", "intersect"] as const)(
    "%s rejects invalid operands before changing receiver coverage",
    (operation) => {
      const receiver = SelectionMask.fromRect({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      });
      for (const invalid of [
        null,
        undefined,
        {},
        1,
        { getCoverage: () => 1 },
      ]) {
        expect(() =>
          receiver[operation](
            // @ts-expect-error Runtime validation protects JavaScript callers.
            invalid,
          ),
        ).toThrow(ReverieTypeError);
        expect(() =>
          receiver[operation](
            // @ts-expect-error Runtime validation protects JavaScript callers.
            invalid,
          ),
        ).toThrow(`[${ErrorCodes.SELECTION.INVALID_MASK}]`);
        expect(receiver.getCoverage(0, 0)).toBe(1);
        expect(receiver.allocatedTileCount).toBe(1);
      }
    },
  );

  it.each([true, false])(
    "clips composed fractional masks in bounded World = %s",
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
      const subtract = new SelectionMask({ tileSize: 2 });
      subtract.setCoverage(0, -1, 128 / 255);
      subtract.setCoverage(0, 0, 128 / 255);
      selection.subtract(subtract);
      const brush = new PixelBrush({
        size: 5,
        color: { r: 20, g: 80, b: 240, a: 255 },
      });
      const layer = world.getLayer(0);

      layer.stamp(brush, { x: 0.5, y: 0.5 }, undefined, selection);

      expect(layer.raster.getPixel({ x: 0, y: -1 }).a).toBe(
        isBounded ? 0 : 127,
      );
      expect(layer.raster.getPixel({ x: 0, y: 0 }).a).toBe(127);
      expect(layer.raster.getPixel({ x: -1, y: 0 }).a).toBe(
        isBounded ? 0 : 255,
      );
      layer.stamp(
        brush,
        { x: 0.5, y: 0.5 },
        { position: { x: 0.5, y: 0.5 }, paintMode: "erase" },
        selection,
      );

      expect(layer.raster.getPixel({ x: 0, y: 0 }).a).toBe(64);
      expect(layer.raster.getPixel({ x: 0, y: -1 }).a).toBe(isBounded ? 0 : 64);
      expect(layer.raster.getPixel({ x: -1, y: 0 }).a).toBe(0);
    },
  );
});
