import { afterEach, describe, expect, it, vi } from "vitest";

import { World } from "@reverie/core";

describe("Document identity fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds process entropy when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const world = new World({ tileSize: 2 });

    expect(world.id).toMatch(/^document-[a-z0-9]+-[a-z0-9]+$/);
    expect(world.getLayer(0).id).toMatch(/^layer-[a-z0-9]+-[a-z0-9]+$/);
    expect(world.id).not.toBe("document-1");
    expect(world.getLayer(0).id).not.toBe("layer-2");
  });
});
