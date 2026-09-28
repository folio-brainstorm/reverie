import { describe, expect, it } from "vitest";

import { ErrorCodes } from "@reveriejs/core";
import { TileStore } from "../../core/src/core/tile/store/TileStore";
import {
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "../../core/src/utils/errors/ReverieErrors";

const TILE_SIZE = 256;

describe("TileStore construction", () => {
  it("creates an empty store with an immutable tile size", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    expect(store.tileSize).toBe(TILE_SIZE);
    expect(store.size).toBe(0);

    if (false) {
      // @ts-expect-error A store cannot change size after construction.
      store.tileSize = 512;
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tile size %s",
    (tileSize) => {
      expect(() => new TileStore({ tileSize })).toThrow(ReverieRangeError);
      expect(() => new TileStore({ tileSize })).toThrow(
        `[${ErrorCodes.COMMON.UNSAFE_TILE_SIZE}]`,
      );
    },
  );
});

describe("TileStore sparse storage", () => {
  it("does not allocate when reading or checking an absent coordinate", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const coord = { x: 100, y: 100 };

    expect(store.get(coord)).toBeUndefined();
    expect(store.has(coord)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("reads trusted coordinates without allocating or public-coordinate conversion", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const tile = store.getOrCreateTrusted(-2, 4);

    expect(store.getTrusted(-2, 4)).toBe(tile);
    expect(store.getTrusted(99, 99)).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it("creates and returns a uniformly sized tile", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    const firstTile = store.create({ x: 0, y: 0 });
    const secondTile = store.create({ x: 100, y: -100 });

    expect(firstTile.size).toBe(store.tileSize);
    expect(secondTile.size).toBe(store.tileSize);
    expect(store.get({ x: 0, y: 0 })).toBe(firstTile);
    expect(store.get({ x: 100, y: -100 })).toBe(secondTile);
    expect(store.size).toBe(2);
  });

  it("reuses the same tile through getOrCreate", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    const firstTile = store.getOrCreate({ x: -2, y: 4 });
    const secondTile = store.getOrCreate({ x: -2, y: 4 });

    expect(secondTile).toBe(firstTile);
    expect(store.size).toBe(1);
  });

  it("supports distant signed coordinates without allocating intermediate tiles", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    const tile = store.getOrCreate({ x: 1_000_000, y: -1_000_000 });

    expect(store.get({ x: 1_000_000, y: -1_000_000 })).toBe(tile);
    expect(store.size).toBe(1);
  });

  it("uses unambiguous keys for coordinates with similar digits and signs", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const coords = [
      { x: 1, y: 23 },
      { x: 12, y: 3 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
    ];

    const tiles = coords.map((coord) => store.create(coord));

    expect(new Set(tiles).size).toBe(coords.length);
    coords.forEach((coord, index) => {
      expect(store.get(coord)).toBe(tiles[index]);
    });
    expect(store.size).toBe(coords.length);
  });

  it("rejects duplicate creation without replacing the existing tile", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const coord = { x: 0, y: 0 };
    const firstTile = store.create(coord);
    firstTile.setPixel({ x: 0, y: 0 }, { r: 255, g: 128, b: 64, a: 255 });
    const createDuplicate = () => store.create(coord);

    expect(createDuplicate).toThrow(ReverieError);
    expect(createDuplicate).toThrow(
      `[${ErrorCodes.TILE.TILE_WAS_ALREADY_EXISTS}]`,
    );
    expect(store.get(coord)).toBe(firstTile);
    expect(store.get(coord)?.getPixel({ x: 0, y: 0 })).toEqual({
      r: 255,
      g: 128,
      b: 64,
      a: 255,
    });
    expect(store.size).toBe(1);
  });

  it("deletes only the requested tile and leaves external references usable", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const coord = { x: 3, y: -4 };
    const tile = store.create(coord);

    expect(store.delete(coord)).toBe(true);
    expect(store.delete(coord)).toBe(false);
    expect(store.has(coord)).toBe(false);
    expect(store.size).toBe(0);

    tile.setPixel({ x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 4 });
    expect(tile.getPixel({ x: 0, y: 0 })).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it("clears every allocated coordinate", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    const coords = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -5, y: 100 },
    ];
    coords.forEach((coord) => store.create(coord));

    store.clear();

    expect(store.size).toBe(0);
    coords.forEach((coord) => {
      expect(store.get(coord)).toBeUndefined();
    });
  });

  it("returns exact bounds after consecutive extremal Tile removals", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });
    store.create({ x: -1, y: 0 });
    store.create({ x: 0, y: 0 });
    store.create({ x: 1, y: 0 });

    store.delete({ x: -1, y: 0 });
    store.delete({ x: 0, y: 0 });

    expect(store.getStatistics()).toEqual({
      tileCount: 1,
      rawPixelBytes: TILE_SIZE * TILE_SIZE * 4,
      tileBounds: { minX: 1, minY: 0, maxX: 1, maxY: 0 },
    });
  });
});

describe("TileStore coordinate validation", () => {
  it.each([
    ["get", (store: TileStore) => store.get({ x: 0.5, y: 0 })],
    ["has", (store: TileStore) => store.has({ x: Number.NaN, y: 0 })],
    ["create", (store: TileStore) => store.create({ x: 0, y: Infinity })],
    ["getOrCreate", (store: TileStore) => store.getOrCreate({ x: -0.5, y: 0 })],
    ["delete", (store: TileStore) => store.delete({ x: 0, y: -Infinity })],
  ] as const)("rejects unsafe coordinates passed to %s", (_, operation) => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    expect(() => operation(store)).toThrow(ReverieRangeError);
    expect(() => operation(store)).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_COORDINATE_VALUE}]`,
    );
    expect(store.size).toBe(0);
  });

  it("rejects non-number coordinate components", () => {
    const store = new TileStore({ tileSize: TILE_SIZE });

    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      store.get({ x: "0", y: 0 });
    }).toThrow(ReverieTypeError);
  });
});
