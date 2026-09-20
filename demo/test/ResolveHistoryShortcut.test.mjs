import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveHistoryShortcut } from "../src/ResolveHistoryShortcut.ts";

test("resolves Ctrl and Command Z as Undo", () => {
  assert.equal(
    resolveHistoryShortcut(keyboard("z", { ctrlKey: true })),
    "undo",
  );
  assert.equal(
    resolveHistoryShortcut(keyboard("Z", { metaKey: true })),
    "undo",
  );
});

test("resolves shifted primary Z and Windows Ctrl Y as Redo", () => {
  assert.equal(
    resolveHistoryShortcut(keyboard("z", { ctrlKey: true, shiftKey: true })),
    "redo",
  );
  assert.equal(
    resolveHistoryShortcut(keyboard("z", { metaKey: true, shiftKey: true })),
    "redo",
  );
  assert.equal(
    resolveHistoryShortcut(keyboard("y", { ctrlKey: true })),
    "redo",
  );
});

test("rejects unmodified, Alt-modified, and Command Y combinations", () => {
  assert.equal(resolveHistoryShortcut(keyboard("z")), null);
  assert.equal(
    resolveHistoryShortcut(keyboard("z", { ctrlKey: true, altKey: true })),
    null,
  );
  assert.equal(resolveHistoryShortcut(keyboard("y", { metaKey: true })), null);
});

function keyboard(key, overrides = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}
