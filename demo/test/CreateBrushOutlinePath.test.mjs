import assert from "node:assert/strict";
import { test } from "node:test";

import { createBrushOutlinePath } from "../src/CreateBrushOutlinePath.ts";

test("a one-pixel brush has four outside edges and no pixel fill", () => {
  assert.equal(
    createBrushOutlinePath({ x: 0.5, y: 0.5 }, 1),
    "M0 0h1M1 0v1M1 1h-1M0 1v-1",
  );
});

test("adjacent pixels produce a single exterior without internal grid lines", () => {
  const path = createBrushOutlinePath({ x: 1, y: 1 }, 2);
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
    createBrushOutlinePath({ x: -0.5, y: -0.5 }, 1),
    "M-1 -1h1M0 -1v1M0 0h-1M-1 0v-1",
  );
});

test("subpixel centers match the rasterizer's empty and covered small circles", () => {
  assert.equal(createBrushOutlinePath({ x: 0, y: 0 }, 1), "");
  assert.notEqual(createBrushOutlinePath({ x: 0.5, y: 0.5 }, 1), "");
});

test("the maximum brush size includes stepped edges rather than a smooth arc", () => {
  const path = createBrushOutlinePath({ x: 0.5, y: 0.5 }, 32);
  const edges = [...path.matchAll(/M(-?\d+) (-?\d+)([hv])(-?1)/g)];
  assert.ok(edges.length > 100);
  assert.ok(edges.length < 200);
  assert.equal(edges.map(([edge]) => edge).join(""), path);
  assert.ok(edges.some(([, x]) => Number(x) < 0));
  assert.ok(edges.some(([, , y]) => Number(y) < 0));
});

test("zero radius respects exact pixel-center coverage", () => {
  assert.equal(createBrushOutlinePath({ x: 0, y: 0 }, 0), "");
  assert.equal(
    createBrushOutlinePath({ x: 0.5, y: 0.5 }, 0),
    "M0 0h1M1 0v1M1 1h-1M0 1v-1",
  );
});

test("invalid numeric inputs preserve the core rasterizer validation", () => {
  for (const size of [-1, NaN, Infinity]) {
    assert.throws(() => createBrushOutlinePath({ x: 0.5, y: 0.5 }, size));
  }
  for (const center of [
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ]) {
    assert.throws(() => createBrushOutlinePath(center, 16));
  }
});
