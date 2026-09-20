import assert from "node:assert/strict";
import { test } from "node:test";

import { createBrushOutlinePath } from "../src/CreateBrushOutlinePath.ts";

test("a one-pixel brush has four outside edges and no pixel fill", () => {
  assert.equal(
    createBrushOutlinePath({ x: 0.5, y: 0.5 }, 1, "smooth"),
    "M0 0h1M1 0v1M1 1h-1M0 1v-1",
  );
});

test("adjacent pixels produce a single exterior without internal grid lines", () => {
  const path = createBrushOutlinePath({ x: 1, y: 1 }, 2, "smooth");
  const edges = [...path.matchAll(/M(-?\d+) (-?\d+)([hv])(-?1)/g)];
  assert.equal(edges.length, 8);
  for (const [, x, y, direction] of edges) {
    if (direction === "h") {
      assert.ok(Number(y) === 0 || Number(y) === 2);
    } else {
      assert.ok(Number(x) === 0 || Number(x) === 2);
    }
  }
});

test("negative world coordinates retain the same exterior footprint", () => {
  assert.equal(
    createBrushOutlinePath({ x: -0.5, y: -0.5 }, 1, "smooth"),
    "M-1 -1h1M0 -1v1M0 0h-1M-1 0v-1",
  );
});

test("smooth subpixel centers retain every fractional coverage pixel", () => {
  assert.notEqual(createBrushOutlinePath({ x: 0, y: 0 }, 1, "smooth"), "");
  assert.notEqual(createBrushOutlinePath({ x: 0.5, y: 0.5 }, 1, "smooth"), "");
});

test("the maximum brush size includes stepped edges rather than a smooth arc", () => {
  const path = createBrushOutlinePath({ x: 0.5, y: 0.5 }, 32, "smooth");
  const edges = [...path.matchAll(/M(-?\d+) (-?\d+)([hv])(-?1)/g)];
  assert.ok(edges.length > 100);
  assert.ok(edges.length < 200);
  assert.equal(edges.map(([edge]) => edge).join(""), path);
  assert.ok(edges.some(([, x]) => Number(x) < 0));
  assert.ok(edges.some(([, , y]) => Number(y) < 0));
});

test("a zero-size smooth outline has no covered pixels", () => {
  assert.equal(createBrushOutlinePath({ x: 0, y: 0 }, 0, "smooth"), "");
  assert.equal(createBrushOutlinePath({ x: 0.5, y: 0.5 }, 0, "smooth"), "");
});

test("pixel outlines match odd and even snapped square footprints", () => {
  assert.equal(
    createBrushOutlinePath({ x: 0.9, y: 0.9 }, 1, "pixel"),
    "M0 0h1v1h-1Z",
  );
  assert.equal(
    createBrushOutlinePath({ x: 4, y: 4 }, 2, "pixel"),
    "M3 3h2v2h-2Z",
  );
  assert.equal(
    createBrushOutlinePath({ x: -0.1, y: -0.1 }, 3, "pixel"),
    "M-2 -2h3v3h-3Z",
  );
});

test("invalid numeric inputs preserve the core rasterizer validation", () => {
  for (const size of [-1, NaN, Infinity]) {
    assert.throws(() =>
      createBrushOutlinePath({ x: 0.5, y: 0.5 }, size, "smooth"),
    );
  }
  for (const center of [
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ]) {
    assert.throws(() => createBrushOutlinePath(center, 16, "smooth"));
  }
});

test("pixel outlines reject non-integer sizes and non-finite centers", () => {
  for (const size of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() =>
      createBrushOutlinePath({ x: 0.5, y: 0.5 }, size, "pixel"),
    );
  }
  assert.throws(() => createBrushOutlinePath({ x: NaN, y: 0 }, 1, "pixel"));
});
