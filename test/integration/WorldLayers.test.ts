import { describe, expect, it, vi } from "vitest";

import {
  ErrorCodes,
  Raster,
  RasterLayer,
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
  World,
} from "@reveriejs/core";
import { getRasterTileVersion } from "@reveriejs/core/rendering/internal";

describe("World layer membership and ordering", () => {
  it.each(["Layer", "", "Sketch"])(
    "preserves an explicitly assigned name %j",
    (name) => {
      const world = new World();
      const layer = world.createRasterLayer();
      expect(layer.hasAssignedName).toBe(false);
      layer.name = name;
      expect(layer.hasAssignedName).toBe(true);
      world.addLayer(layer);
      expect(layer.name).toBe(name);
      expect(world.addLayer().name).toBe("Layer 2");
    },
  );

  it("does not allocate a default layer when insertion is invalid or reentrant", () => {
    const world = new World();
    const layer = world.addLayer();
    const create = vi.spyOn(world, "createRasterLayer");
    for (const index of [-1, 99, 0.5, Number.NaN]) {
      expect(() => world.insertLayer(index)).toThrow(ReverieRangeError);
    }
    world.observeLayerRemoval({
      beforeRemove: () => {
        expect(() => world.addLayer()).toThrow(ReverieError);
        expect(() => world.insertLayer(0)).toThrow(ReverieError);
      },
    });
    world.removeLayer(layer);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it("distinguishes range, incompatible type, ownership and membership errors", () => {
    const world = new World({ tileSize: 4 });
    expect(() => world.getLayer(-1)).toThrow(ReverieRangeError);
    expect(() => world.getLayer(new World().getLayer(0))).toThrow(ReverieError);
    expect(() => world.addLayer(world.getLayer(0))).toThrow(ReverieError);
    expect(() =>
      world.addLayer(new World({ tileSize: 8 }).getLayer(0)),
    ).toThrow(ReverieError);
    expect(() =>
      world.addLayer(new World({ tileSize: 8 }).createRasterLayer()),
    ).toThrow(ReverieTypeError);
    // @ts-expect-error Untyped callers may supply an incompatible layer value.
    expect(() => world.insertLayer(0, {})).toThrow(ReverieTypeError);
  });

  it.each([false, true])(
    "always releases removal reservations (reject=%s)",
    (shouldReject) => {
      const world = new World();
      const layer = world.addLayer();
      const settled = vi.fn();
      world.observeLayerRemoval({
        beforeRemove: () => {
          if (shouldReject) {
            throw new Error("rejected");
          }
        },
        afterRemovalAttempt: settled,
      });
      if (shouldReject) {
        expect(() => world.removeLayer(layer)).toThrow("rejected");
        expect(world.layers).toContain(layer);
      } else {
        world.removeLayer(layer);
      }
      expect(settled).toHaveBeenCalledOnce();
      expect(() => world.addLayer()).not.toThrow();
    },
  );

  it("creates one default empty visible layer in either constructor path", () => {
    for (const world of [new World(), new World({ tileSize: 4 })]) {
      expect(world.layers).toHaveLength(1);
      expect(world.getLayer(0).name).toBe("Layer 1");
      expect(world.getLayer(0).visible).toBe(true);
      expect(world.getLayer(0).opacity).toBe(1);
      expect(world.getLayer(0).blendMode).toBe("normal");
      expect(world.getLayer(0).raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    }
  });

  it.each([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "add",
  ] as const)("accepts the %s layer blend mode", (mode) => {
    const layer = new World().getLayer(0);
    layer.blendMode = mode;
    expect(layer.blendMode).toBe(mode);
  });

  it("rejects unsupported layer blend modes without changing the current mode", () => {
    const layer = new World().getLayer(0);
    // @ts-expect-error Untyped callers may provide an unsupported mode.
    expect(() => (layer.blendMode = "color-dodge")).toThrow(
      ErrorCodes.WORLD.INVALID_LAYER_BLEND_MODE,
    );
    expect(layer.blendMode).toBe("normal");
  });

  it("keeps standalone Raster and detached createRasterLayer behavior", () => {
    const raster = new Raster({ tileSize: 4 });
    const world = new World({ tileSize: 4 });
    const detached = world.createRasterLayer();
    raster.setPixel({ x: -1, y: 0 }, { r: 1, g: 2, b: 3, a: 255 });
    expect(raster.getPixel({ x: -1, y: 0 }).a).toBe(255);
    expect(world.layers).toHaveLength(1);
    expect(world.addLayer(detached)).toBe(detached);
    expect(world.getLayer(detached)).toBe(detached);
  });

  it("exposes immutable snapshots and cannot be emptied through the collection", () => {
    const world = new World();
    const snapshot = world.layers;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => Reflect.set(snapshot, "length", 0)).not.toThrow();
    expect(snapshot).toHaveLength(1);
    const layer = world.insertLayer(0);
    expect(world.layers[0]).toBe(layer);
    expect(snapshot).toHaveLength(1);
  });

  it("moves to final indices in both directions without changing source pixels", () => {
    const world = new World({ tileSize: 2 });
    const first = world.getLayer(0);
    const second = world.addLayer();
    const third = world.addLayer();
    const color = { r: 20, g: 30, b: 40, a: 200 };
    first.raster.setPixel({ x: -1, y: 2 }, color);
    const version = getRasterTileVersion(first.raster, { x: -1, y: 1 });
    world.moveLayer(0, 2);
    expect(world.layers).toEqual([second, third, first]);
    world.moveLayer(first, 0);
    expect(world.layers).toEqual([first, second, third]);
    world.moveLayer(first, 0);
    expect(first.raster.getPixel({ x: -1, y: 2 })).toEqual(color);
    expect(getRasterTileVersion(first.raster, { x: -1, y: 1 })).toEqual(
      version,
    );
  });

  it.each([
    -1,
    1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects nonmember index %s without changing the document", (index) => {
    const world = new World();
    expect(() => world.getLayer(index)).toThrow(
      ErrorCodes.WORLD.INVALID_LAYER_INDEX,
    );
    expect(() => world.moveLayer(0, index)).toThrow(
      ErrorCodes.WORLD.INVALID_LAYER_INDEX,
    );
    expect(() => world.removeLayer(index)).toThrow(
      ErrorCodes.WORLD.INVALID_LAYER_INDEX,
    );
    expect(world.layers).toHaveLength(1);
  });

  it.each([-1, 2, 0.5, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects insertion index %s",
    (index) => {
      const world = new World();
      expect(() => world.insertLayer(index)).toThrow(
        ErrorCodes.WORLD.INVALID_LAYER_INDEX,
      );
      expect(world.layers).toHaveLength(1);
    },
  );

  it("rejects the final layer and foreign references before notifying observers", () => {
    const world = new World();
    const foreign = new World().getLayer(0);
    let calls = 0;
    world.observeLayerRemoval({
      beforeRemove: () => {
        calls += 1;
      },
    });
    expect(() => world.removeLayer(0)).toThrow(
      ErrorCodes.WORLD.LAST_LAYER_REMOVAL,
    );
    expect(() => world.removeLayer(foreign)).toThrow(
      ErrorCodes.WORLD.LAYER_NOT_FOUND,
    );
    expect(() => world.moveLayer(foreign, 0)).toThrow(
      ErrorCodes.WORLD.LAYER_NOT_FOUND,
    );
    expect(calls).toBe(0);
    expect(world.layers).toHaveLength(1);
  });

  it("rejects duplicate layer and Raster registration, including across Worlds", () => {
    const world = new World({ tileSize: 4 });
    const other = new World({ tileSize: 4 });
    const member = world.getLayer(0);
    expect(() => world.addLayer(member)).toThrow(
      ErrorCodes.WORLD.DUPLICATE_LAYER_OWNERSHIP,
    );
    expect(() => other.addLayer(member)).toThrow(
      ErrorCodes.WORLD.DUPLICATE_LAYER_OWNERSHIP,
    );
    expect(() => other.addLayer(new RasterLayer(member.raster, null))).toThrow(
      ErrorCodes.WORLD.DUPLICATE_LAYER_OWNERSHIP,
    );
    expect(world.layers).toHaveLength(1);
    expect(other.layers).toHaveLength(1);
  });

  it("preserves pixels and releases ownership when transferring a removed layer", () => {
    const world = new World({ tileSize: 4 });
    const other = new World({ tileSize: 4 });
    const layer = world.addLayer();
    const color = { r: 1, g: 2, b: 3, a: 255 };
    layer.raster.setPixel({ x: 4, y: -1 }, color);
    expect(world.removeLayer(layer)).toBe(layer);
    expect(other.addLayer(layer)).toBe(layer);
    expect(layer.raster.getPixel({ x: 4, y: -1 })).toEqual(color);
  });

  it("rejects incompatible tile sizes and paint bounds", () => {
    const world = new World({
      tileSize: 4,
      bounds: { x: -1, y: 0, width: 4, height: 4 },
    });
    const candidates = [
      new World({ tileSize: 8, bounds: world.bounds }).createRasterLayer(),
      new World({ tileSize: 4 }).createRasterLayer(),
      new World({
        tileSize: 4,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      }).createRasterLayer(),
    ];
    for (const layer of candidates) {
      expect(() => world.addLayer(layer)).toThrow(
        ErrorCodes.WORLD.INCOMPATIBLE_LAYER,
      );
    }
    expect(world.layers).toHaveLength(1);
  });

  it("rejects guard failures atomically and supports observer unsubscription", () => {
    const world = new World();
    const layer = world.addLayer();
    const snapshot = world.layers;
    const unsubscribe = world.observeLayerRemoval({
      beforeRemove: () => {
        throw new Error("busy");
      },
    });
    expect(() => world.removeLayer(layer)).toThrow("busy");
    expect(world.layers).toBe(snapshot);
    unsubscribe();
    unsubscribe();
    let afterIndex = -1;
    world.observeLayerRemoval({
      afterRemove: (removed, index) => {
        expect(removed).toBe(layer);
        expect(world.layers).toHaveLength(1);
        afterIndex = index;
      },
    });
    world.removeLayer(layer);
    expect(afterIndex).toBe(1);
  });

  it("prevents removal callbacks from changing membership or order recursively", () => {
    const world = new World();
    const layer = world.addLayer();
    const stop = world.observeLayerRemoval({
      beforeRemove: () => {
        world.addLayer();
      },
    });
    expect(() => world.removeLayer(layer)).toThrow(
      ErrorCodes.WORLD.REENTRANT_LAYER_CHANGE,
    );
    expect(world.layers).toHaveLength(2);
    stop();
    expect(world.removeLayer(layer)).toBe(layer);
  });
});

describe("RasterLayer non-destructive composition metadata", () => {
  it.each([0, 0.25, 0.5, 1])(
    "accepts opacity %s without changing pixels or revisions",
    (opacity) => {
      const layer = new World({ tileSize: 4 }).getLayer(0);
      const color = { r: 50, g: 60, b: 70, a: 128 };
      layer.raster.setPixel({ x: 0, y: 0 }, color);
      const version = getRasterTileVersion(layer.raster, { x: 0, y: 0 });
      layer.opacity = opacity;
      layer.visible = false;
      layer.name = "Sketch";
      expect(layer.opacity).toBe(opacity);
      layer.opacity = 1;
      layer.visible = true;
      expect(layer.raster.getPixel({ x: 0, y: 0 })).toEqual(color);
      expect(getRasterTileVersion(layer.raster, { x: 0, y: 0 })).toEqual(
        version,
      );
    },
  );

  it.each([
    -1,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])(
    "rejects invalid opacity %s without changing the previous value",
    (opacity) => {
      const layer = new World().getLayer(0);
      layer.opacity = 0.5;
      expect(() => {
        layer.opacity = opacity;
      }).toThrow(ErrorCodes.WORLD.INVALID_LAYER_OPACITY);
      expect(layer.opacity).toBe(0.5);
    },
  );
});
