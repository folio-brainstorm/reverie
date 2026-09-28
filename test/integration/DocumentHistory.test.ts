import { describe, expect, it } from "vitest";

import { CircleBrush, ErrorCodes, SelectionMask, World } from "@reveriejs/core";
import type { Raster } from "@reveriejs/core";
import { DocumentHistory } from "@reveriejs/core/history";
import { getRasterTileVersion } from "@reveriejs/core/rendering/internal";

const RED = { r: 255, g: 10, b: 20, a: 255 };
const BLUE = { r: 10, g: 20, b: 255, a: 180 };

describe("DocumentHistory Raster transactions", () => {
  it("restores sparse Tile absence and exact pixels through undo and redo", () => {
    const world = new World({ tileSize: 4 });
    const raster = world.getLayer(0).raster;
    const history = new DocumentHistory({ world });

    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: -1, y: -1 }, RED);
      raster.setPixel({ x: 4, y: 0 }, BLUE);
    });

    expect(raster.allocatedTileCount).toBe(2);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(raster.allocatedTileCount).toBe(0);
    expect(raster.getPixel({ x: -1, y: -1 }).a).toBe(0);

    history.redo();
    expect(raster.allocatedTileCount).toBe(2);
    expect(raster.getPixel({ x: -1, y: -1 })).toEqual(RED);
    expect(raster.getPixel({ x: 4, y: 0 })).toEqual(BLUE);
  });

  it("restores erased RGBA state exactly without replaying the Brush", () => {
    const world = new World({ tileSize: 4 });
    const raster = world.getLayer(0).raster;
    raster.setPixel({ x: 0, y: 0 }, BLUE);
    const history = new DocumentHistory({ world });

    commitRasterMutation(history, raster, () => {
      raster.erasePixel({ x: 0, y: 0 }, 1);
    });
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...BLUE, a: 0 });

    history.undo();
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(BLUE);
    history.redo();
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...BLUE, a: 0 });
  });

  it("discards an empty transaction without clearing existing Redo", () => {
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    const history = new DocumentHistory({ world });
    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 0, y: 0 }, RED);
    });
    history.undo();

    commitRasterMutation(history, raster, () => undefined);

    expect(history.canRedo).toBe(true);
  });

  it("clears Redo when a new changed edit commits after Undo", () => {
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    const history = new DocumentHistory({ world });
    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 0, y: 0 }, RED);
    });
    history.undo();

    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 1, y: 1 }, BLUE);
    });

    expect(history.canRedo).toBe(false);
  });

  it("rolls back executed writes when a transaction is cancelled", () => {
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    const history = new DocumentHistory({ world });
    const transaction = history.beginRasterTransaction(raster);
    transaction.scheduleMutation();
    transaction.executeMutation(() => {
      raster.setPixel({ x: 0, y: 0 }, RED);
    });

    transaction.cancel();

    expect(raster.allocatedTileCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it("records painting through Selection while leaving Selection unchanged", () => {
    const world = new World({ tileSize: 4 });
    const layer = world.getLayer(0);
    const history = new DocumentHistory({ world });
    const selection = SelectionMask.fromRect({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const brush = new CircleBrush({ size: 3, color: RED, opacity: 1 });

    commitRasterMutation(history, layer.raster, () => {
      layer.stamp(brush, { x: 0.5, y: 0.5 }, undefined, selection);
    });
    expect(layer.raster.getPixel({ x: 0, y: 0 }).a).toBe(255);
    expect(layer.raster.getPixel({ x: 1, y: 0 }).a).toBe(0);

    history.undo();
    expect(layer.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    expect(selection.getCoverage(0, 0)).toBe(1);
  });

  it("advances Tile revision instead of restoring an obsolete counter", () => {
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    raster.setPixel({ x: 0, y: 0 }, BLUE);
    const history = new DocumentHistory({ world });
    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 0, y: 0 }, RED);
    });
    const committedRevision = getRasterTileVersion(raster, { x: 0, y: 0 });

    history.undo();
    const undoneRevision = getRasterTileVersion(raster, { x: 0, y: 0 });

    expect(undoneRevision?.tileId).toBe(committedRevision?.tileId);
    expect(undoneRevision?.revision).toBeGreaterThan(
      committedRevision?.revision ?? 0,
    );
  });

  it("records clear as one reversible edit", () => {
    const world = new World({ tileSize: 2 });
    const raster = world.getLayer(0).raster;
    raster.setPixel({ x: 0, y: 0 }, RED);
    raster.setPixel({ x: 4, y: 0 }, BLUE);
    const history = new DocumentHistory({ world });

    history.performRasterMutation(raster, () => raster.clear());
    expect(raster.allocatedTileCount).toBe(0);

    history.undo();
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
    expect(raster.getPixel({ x: 4, y: 0 })).toEqual(BLUE);
  });
});

describe("DocumentHistory World mutations", () => {
  it("restores add, remove, reorder, identity, and the nonempty invariant", () => {
    const world = new World();
    const first = world.getLayer(0);
    const history = new DocumentHistory({ world });
    const second = world.addLayer();
    world.moveLayer(second, 0);
    world.removeLayer(first);

    history.undo();
    expect(world.layers).toEqual([second, first]);
    history.undo();
    expect(world.layers).toEqual([first, second]);
    history.undo();
    expect(world.layers).toEqual([first]);
    expect(world.layers.length).toBe(1);

    history.redo();
    expect(world.layers[1]).toBe(second);
  });

  it("groups Layer properties into one Undo step", () => {
    const world = new World();
    const layer = world.getLayer(0);
    const history = new DocumentHistory({ world });
    history.beginGroup();
    layer.name = "Ink";
    layer.visible = false;
    layer.opacity = 0.25;
    layer.blendMode = "multiply";
    history.commitGroup();

    history.undo();
    expect(layer.name).toBe("Layer 1");
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");

    history.redo();
    expect(layer.name).toBe("Ink");
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(0.25);
    expect(layer.blendMode).toBe("multiply");
  });

  it("cancels a group by restoring every accumulated mutation", () => {
    const world = new World();
    const layer = world.getLayer(0);
    const history = new DocumentHistory({ world });
    history.beginGroup();
    layer.name = "Temporary";
    layer.opacity = 0.5;

    history.cancelGroup();

    expect(layer.name).toBe("Layer 1");
    expect(layer.opacity).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it("keeps the newest oversized entry while evicting older Undo entries", () => {
    const world = new World({ tileSize: 1 });
    const raster = world.getLayer(0).raster;
    const history = new DocumentHistory({ world });
    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 0, y: 0 }, RED);
    });
    commitRasterMutation(history, raster, () => {
      raster.setPixel({ x: 1, y: 0 }, BLUE);
    });

    history.setByteBudgetForTesting(1);
    history.undo();

    expect(history.canUndo).toBe(false);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(RED);
    expect(raster.getPixel({ x: 1, y: 0 }).a).toBe(0);
  });

  it("rejects nested groups with a stable error code", () => {
    const history = new DocumentHistory();
    history.beginGroup();

    expect(() => history.beginGroup()).toThrow(
      `[${ErrorCodes.HISTORY.GROUP_ALREADY_ACTIVE}]`,
    );
  });
});

function commitRasterMutation(
  history: DocumentHistory,
  raster: Raster,
  operation: () => void,
): void {
  const transaction = history.beginRasterTransaction(raster);
  transaction.scheduleMutation();
  transaction.executeMutation(operation);
  transaction.close();
}
