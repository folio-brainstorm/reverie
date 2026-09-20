import assert from "node:assert/strict";
import { test } from "node:test";

import { createSelectionRect } from "../src/CreateSelectionRect.ts";

const CANVAS_SIZE = { width: 10, height: 8 };

test("a click selects exactly the pixel under the pointer", () => {
  assert.deepEqual(
    createSelectionRect(
      { x: 3.25, y: 4.75 },
      { x: 3.25, y: 4.75 },
      CANVAS_SIZE,
    ),
    { x: 3, y: 4, width: 1, height: 1 },
  );
});

test("forward and reverse drags produce identical half-open rectangles", () => {
  const forward = createSelectionRect(
    { x: 1.2, y: 2.8 },
    { x: 6.9, y: 5.1 },
    CANVAS_SIZE,
  );
  const reverse = createSelectionRect(
    { x: 6.9, y: 5.1 },
    { x: 1.2, y: 2.8 },
    CANVAS_SIZE,
  );

  assert.deepEqual(forward, { x: 1, y: 2, width: 6, height: 4 });
  assert.deepEqual(reverse, forward);
});

test("drag endpoints outside the document clamp to Canvas bounds", () => {
  assert.deepEqual(
    createSelectionRect({ x: -20, y: -4 }, { x: 40, y: 30 }, CANVAS_SIZE),
    { x: 0, y: 0, width: 10, height: 8 },
  );
});

test("right and bottom half-open edges resolve to the final document pixel", () => {
  assert.deepEqual(
    createSelectionRect({ x: 9.2, y: 7.1 }, { x: 10, y: 8 }, CANVAS_SIZE),
    { x: 9, y: 7, width: 1, height: 1 },
  );
});

test("rectangle resolution does not mutate its inputs", () => {
  const anchor = Object.freeze({ x: 2.2, y: 3.3 });
  const current = Object.freeze({ x: 4.4, y: 5.5 });
  const size = Object.freeze({ ...CANVAS_SIZE });

  createSelectionRect(anchor, current, size);

  assert.deepEqual(anchor, { x: 2.2, y: 3.3 });
  assert.deepEqual(current, { x: 4.4, y: 5.5 });
  assert.deepEqual(size, CANVAS_SIZE);
});
