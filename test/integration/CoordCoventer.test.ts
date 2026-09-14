import { describe, expect, it } from "vitest";

import { CoordCoverter } from "../../core/src/utils/number/coords/CoordCoverter";

const TILE_SIZE = 256;

describe("CoordCoverter.World", () => {
  it.each([
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 255, y: 255 }, { x: 0, y: 0 }, { x: 255, y: 255 }],
    [{ x: 256, y: 256 }, { x: 1, y: 1 }, { x: 0, y: 0 }],
    [{ x: -1, y: -1 }, { x: -1, y: -1 }, { x: 255, y: 255 }],
    [{ x: -256, y: -256 }, { x: -1, y: -1 }, { x: 0, y: 0 }],
    [{ x: -257, y: -257 }, { x: -2, y: -2 }, { x: 255, y: 255 }],
    [{ x: -1, y: 256 }, { x: -1, y: 1 }, { x: 255, y: 0 }],
    [{ x: -257, y: 300 }, { x: -2, y: 1 }, { x: 255, y: 44 }],
  ])(
    "maps world coordinate %o to tile %o and local coordinate %o",
    (world, tile, local) => {
      expect(CoordCoverter.World.locateWorldPixel(world, TILE_SIZE)).toEqual({
        tile,
        local,
      });
      expect(CoordCoverter.World.worldCoordToTileCoord(world, TILE_SIZE)).toEqual(tile);
      expect(CoordCoverter.World.worldCoordToLocalPixelCoord(world, TILE_SIZE)).toEqual(local);
    },
  );

  it("preserves the mapping invariants", () => {
    const world = { x: -12_345, y: 67_890 };
    const { tile, local } = CoordCoverter.World.locateWorldPixel(world, TILE_SIZE);

    expect(local.x).toBeGreaterThanOrEqual(0);
    expect(local.x).toBeLessThan(TILE_SIZE);
    expect(local.y).toBeGreaterThanOrEqual(0);
    expect(local.y).toBeLessThan(TILE_SIZE);
    expect(tile.x * TILE_SIZE + local.x).toBe(world.x);
    expect(tile.y * TILE_SIZE + local.y).toBe(world.y);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "rejects invalid tile size %s",
    (tileSize) => {
      expect(() => CoordCoverter.World.locateWorldPixel({ x: 0, y: 0 }, tileSize))
        .toThrow(RangeError);
    },
  );
});
