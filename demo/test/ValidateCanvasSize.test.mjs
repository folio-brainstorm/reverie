import assert from "node:assert/strict";
import { test } from "node:test";

import { validateCanvasSize } from "../src/ValidateCanvasSize.ts";

test("common, custom, minimum and maximum-area canvas sizes are accepted", () => {
  for (const [width, height] of [
    [1, 1],
    [1024, 768],
    [801, 603],
    [1080, 1920],
    [3840, 2160],
    [4096, 4096],
    [8192, 2048],
    [2048, 8192],
  ]) {
    assert.equal(
      validateCanvasSize({ width, height }),
      null,
      `${width} × ${height}`,
    );
  }
});

test("zero, negative and oversized dimensions fail before initialization", () => {
  for (const dimension of [0, -1, 8193, Number.MAX_SAFE_INTEGER]) {
    for (const size of [
      { width: dimension, height: 768 },
      { width: 1024, height: dimension },
    ]) {
      assert.match(validateCanvasSize(size), /between 1 and 8192/);
    }
  }
});

test("fractional and non-finite dimensions require whole numbers", () => {
  for (const dimension of [0.5, 768.5, NaN, Infinity, -Infinity]) {
    for (const size of [
      { width: dimension, height: 768 },
      { width: 1024, height: dimension },
    ]) {
      assert.match(validateCanvasSize(size), /whole number/);
    }
  }
});

test("dimensions within the per-side limit still respect the total area", () => {
  for (const size of [
    { width: 4096, height: 4097 },
    { width: 8192, height: 2049 },
    { width: 8192, height: 8192 },
  ]) {
    assert.match(validateCanvasSize(size), /too large/);
  }
});

test("validation leaves the submitted dimensions unchanged", () => {
  const size = Object.freeze({ width: 801, height: 603 });
  assert.equal(validateCanvasSize(size), null);
  assert.deepEqual(size, { width: 801, height: 603 });
});
