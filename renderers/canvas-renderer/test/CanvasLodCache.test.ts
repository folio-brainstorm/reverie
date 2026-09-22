import { describe, expect, it } from "vitest";

import CanvasLodCache from "../src/canvas/CanvasLodCache.js";
import type { CanvasLodCacheEntry } from "../src/interfaces/canvas/CanvasLodCacheEntry.js";

function createEntry(signature: string, byteCost = 4): CanvasLodCacheEntry {
  return {
    canvas: {} as HTMLCanvasElement,
    context: {} as CanvasRenderingContext2D,
    byteCost,
    signature,
  };
}

describe("CanvasLodCache", () => {
  it("evicts the least-recently-used entries by approximate byte cost", () => {
    const cache = new CanvasLodCache(8);
    const first = createEntry("first");
    const second = createEntry("second");
    const third = createEntry("third");

    cache.set("first", first);
    cache.set("second", second);
    expect(cache.get("first")).toBe(first);
    cache.set("third", third);

    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(first);
    expect(cache.get("third")).toBe(third);
  });

  it("does not retain an entry whose byte cost exceeds the whole budget", () => {
    const cache = new CanvasLodCache(8);

    cache.set("oversized", createEntry("oversized", 12));

    expect(cache.get("oversized")).toBeUndefined();
  });
});
