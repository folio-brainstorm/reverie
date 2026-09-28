import { describe, expect, it } from "vitest";

import type { RenderRegion } from "@reverie/core/rendering";
import type { RenderRequestIdentity } from "@reverie/core/rendering/internal";

import PresentationState from "../src/canvas/PresentationState.js";

function createRegion(x: number, red: number): RenderRegion {
  return {
    bounds: { x, y: 0, width: 2, height: 2 },
    pixels: new Uint8Array([red, 0, 0, 255]),
  };
}

describe("PresentationState", () => {
  it("retains a smaller preview beside canonical pixels and selects it for interactive projection", () => {
    const state = new PresentationState();
    const canonical = { ...createRegion(0, 60), pixels: new Uint8Array(16) };
    const preview = {
      ...createRegion(0, 30),
      resultClass: "approximate" as const,
    };
    const full = {
      viewport: { x: 0, y: 0, width: 2, height: 2 },
      sourceRevision: "0",
      scaleKey: "1",
      quality: "full" as const,
      outputTileSize: 2,
      resultClass: "canonical" as const,
    };
    const interactive = {
      ...full,
      quality: "interactive" as const,
      outputTileSize: 1,
      resultClass: "approximate" as const,
    };
    state.addWarmRegions([canonical], full);
    state.addWarmRegions([preview], interactive);

    expect(state.getReusableRegions(interactive)).toEqual([preview]);
    expect(state.getReusableRegions(full)).toEqual([canonical]);
    expect(state.getProvisionalRegions(interactive)).toEqual([preview]);
    expect(state.getProvisionalRegions(full)).toEqual([canonical]);
    expect(state.retainedRegionCount).toBe(2);
    expect(state.getZoneCounts(full.viewport, full.viewport)).toEqual({
      visible: 1,
      warm: 0,
      retained: 0,
    });

    state.retainSourceChanges("1", [{ x: 0, y: 0 }], 2);
    expect(state.retainedRegionCount).toBe(0);
  });

  it("bounds retained variants while replacing interactive sizes and evicts both outside retention", () => {
    const state = new PresentationState();
    const viewport = { x: -2, y: 0, width: 2, height: 2 };
    const full = {
      viewport,
      sourceRevision: "0",
      scaleKey: "1",
      quality: "full" as const,
      outputTileSize: 4,
      resultClass: "canonical" as const,
    };
    const canonical = { ...createRegion(-2, 60), pixels: new Uint8Array(64) };
    state.addWarmRegions([canonical], full);
    for (const outputTileSize of [2, 1, 2, 1]) {
      const context = {
        ...full,
        quality: "interactive" as const,
        outputTileSize,
        resultClass: "approximate" as const,
      };
      const preview = {
        ...createRegion(-2, 30),
        pixels: new Uint8Array(outputTileSize ** 2 * 4),
        resultClass: "approximate" as const,
      };
      state.addWarmRegions([preview], context);
      expect(state.retainedRegionCount).toBe(2);
      expect(state.getReusableRegions(context)).toEqual([preview]);
      expect(state.getReusableRegions(full)).toEqual([canonical]);
    }
    state.retainSourceChanges("1", [{ x: 0, y: 0 }], 2);
    expect(state.getReusableRegions(full)).toEqual([]);
    expect(state.getReusableRegions({ ...full, sourceRevision: "1" })).toEqual([
      canonical,
    ]);
    state.retainNear({ x: 0, y: 0, width: 2, height: 2 }, 0);
    expect(state.retainedRegionCount).toBe(0);
  });

  it("retains completed transparent previews across cancellation without presenting partial removal", () => {
    const state = new PresentationState();
    const identity = {
      requestId: 1,
      viewportKey: "first",
      sourceRevision: "0",
    };
    const full = {
      viewport: { x: 0, y: 0, width: 2, height: 2 },
      sourceRevision: "0",
      scaleKey: "1",
      quality: "full" as const,
      outputTileSize: 2,
      resultClass: "canonical" as const,
    };
    const canonical = {
      ...createRegion(0, 60),
      pixels: new Uint8Array(16).fill(255),
    };
    state.begin(identity, full);
    state.append({ identity, regions: [canonical] });
    const interactive = {
      ...full,
      outputTileSize: 1,
      quality: "interactive" as const,
      resultClass: "approximate" as const,
    };
    const preview = {
      ...createRegion(0, 0),
      pixels: new Uint8Array(4),
      resultClass: "approximate" as const,
    };
    const pending = { ...identity, requestId: 2 };
    const batch = {
      identity: pending,
      regions: [preview],
      continuation: { isRenderContinuation: true as const, identity: pending },
    };
    state.begin(pending, interactive);
    expect(state.append(batch)).toBeNull();
    expect(state.applyProvisional(batch)).toEqual([]);
    expect(state.visibleFrame?.regions).toEqual([canonical]);
    state.cancelPending();
    expect(state.getReusableRegions(interactive)).toEqual([preview]);
    expect(state.getReusableRegions(full)).toEqual([canonical]);

    const next = { ...identity, requestId: 3, viewportKey: "next" };
    state.begin(next, interactive, state.getReusableRegions(interactive));
    expect(
      state.append({ identity: next, regions: [] })?.frame.regions,
    ).toEqual([preview]);
    // A complete empty result removes every cached variant at that coordinate.
    state.begin({ ...next, requestId: 4 }, full);
    state.append({ identity: { ...next, requestId: 4 }, regions: [] });
    expect(state.retainedRegionCount).toBe(0);
  });

  const first: RenderRequestIdentity = {
    requestId: 1,
    viewportKey: "viewport",
    sourceRevision: "0",
  };
  const second: RenderRequestIdentity = {
    requestId: 2,
    viewportKey: "viewport",
    sourceRevision: "1",
  };

  it("keeps approximate Regions out of settled reuse and favors canonical warm pixels", () => {
    const state = new PresentationState();
    const preview = {
      ...createRegion(0, 30),
      resultClass: "approximate" as const,
    };
    const canonical = createRegion(0, 60);
    const viewport = { x: 0, y: 0, width: 2, height: 2 };
    const base = {
      viewport,
      sourceRevision: "0",
      scaleKey: "0.5",
      quality: "interactive" as const,
      outputTileSize: 1,
    };
    const interactive = { ...base, resultClass: "approximate" as const };
    const settled = {
      ...base,
      quality: "full" as const,
      resultClass: "canonical" as const,
    };

    state.addWarmRegions([preview], interactive);
    expect(state.getReusableRegions(interactive)).toEqual([preview]);
    expect(state.getReusableRegions(settled)).toEqual([]);
    state.addWarmRegions([canonical], settled);
    expect(state.getReusableRegions(settled)).toEqual([canonical]);
    state.addWarmRegions([preview], interactive);
    expect(state.getReusableRegions(interactive)).toEqual([canonical]);
    expect(state.getReusableRegions(settled)).toEqual([canonical]);
  });

  it("accumulates multiple batches before replacing visible bounds", () => {
    const state = new PresentationState();
    const oldA = createRegion(0, 1);
    const oldB = createRegion(2, 2);
    const newA = createRegion(0, 3);
    const newC = createRegion(4, 4);
    state.begin(first);
    state.append({ identity: first, regions: [oldA, oldB] });
    state.begin(second);
    const continuation = {
      isRenderContinuation: true,
      identity: second,
    } as const;

    expect(
      state.append({ identity: second, regions: [newA], continuation }),
    ).toBeNull();
    expect(
      state.append({ identity: second, regions: [newC], continuation }),
    ).toBeNull();
    expect(state.visibleFrame?.regions).toEqual([oldA, oldB]);

    const commit = state.append({ identity: second, regions: [] });

    expect(commit?.frame.regions).toEqual([newA, newC]);
    expect(commit?.removedBounds).toEqual([oldB.bounds]);
    expect(state.visibleFrame?.regions).toEqual([newA, newC]);
    expect(state.pendingIdentity).toBeNull();
  });

  it("rejects mismatched and cancelled batches without changing visible regions", () => {
    const state = new PresentationState();
    const oldRegion = createRegion(-2, 1);
    state.begin(first);
    state.append({ identity: first, regions: [oldRegion] });
    state.begin(second);

    expect(
      state.append({ identity: first, regions: [createRegion(0, 2)] }),
    ).toBeNull();
    expect(
      state.append({
        identity: { ...second, viewportKey: "other" },
        regions: [createRegion(0, 2)],
      }),
    ).toBeNull();
    expect(
      state.append({
        identity: { ...second, sourceRevision: "other" },
        regions: [createRegion(0, 2)],
      }),
    ).toBeNull();
    state.cancelPending();
    expect(
      state.append({ identity: second, regions: [createRegion(0, 3)] }),
    ).toBeNull();
    expect(state.visibleFrame?.regions).toEqual([oldRegion]);
  });

  it("accepts safe completed regions early and preserves unrelated coverage", () => {
    const state = new PresentationState();
    const oldA = createRegion(0, 1);
    const oldB = createRegion(2, 2);
    const newA = createRegion(0, 3);
    const newB = createRegion(2, 4);
    const continuation = {
      isRenderContinuation: true,
      identity: second,
    } as const;
    state.begin(first);
    state.append({ identity: first, regions: [oldA, oldB] });
    state.begin(second, {
      viewport: { x: 0, y: 0, width: 6, height: 2 },
      sourceRevision: "1",
      scaleKey: "1",
      quality: "interactive",
      outputTileSize: 1,
    });
    const batch = { identity: second, regions: [newA, newB], continuation };

    expect(state.append(batch)).toBeNull();
    expect(state.applyProvisional(batch)).toEqual([newA, newB]);
    expect(state.visibleFrame?.regions).toEqual([newA, newB]);
  });

  it("rejects stale interactive output after a newer source revision", () => {
    const state = new PresentationState();
    const oldRegion = createRegion(0, 1);
    state.begin(first);
    state.append({ identity: first, regions: [oldRegion] });
    state.begin(second);
    state.cancelPending();
    state.begin({ requestId: 3, viewportKey: "viewport", sourceRevision: "2" });
    const stale = {
      identity: second,
      regions: [createRegion(0, 3)],
      continuation: { isRenderContinuation: true, identity: second } as const,
    };

    expect(state.applyProvisional(stale)).toEqual([]);
    expect(state.visibleFrame?.regions).toEqual([oldRegion]);
  });

  it("leaves transparent hinted output for completed reconciliation", () => {
    const state = new PresentationState();
    const oldRegion = createRegion(0, 1);
    state.begin(first);
    state.append({ identity: first, regions: [oldRegion] });
    state.begin(second, {
      viewport: { x: 0, y: 0, width: 2, height: 2 },
      sourceRevision: "1",
      scaleKey: "1",
      quality: "interactive",
      outputTileSize: 1,
    });
    const partial = {
      identity: second,
      regions: [
        { bounds: oldRegion.bounds, pixels: new Uint8Array([0, 0, 0, 0]) },
      ],
      continuation: { isRenderContinuation: true, identity: second } as const,
    };

    state.append(partial);

    expect(state.applyProvisional(partial)).toEqual([]);
    expect(state.visibleFrame?.regions).toEqual([oldRegion]);
  });

  it("reconciles removals from a completed request after an interactive update", () => {
    const state = new PresentationState();
    const oldA = createRegion(0, 1);
    const oldB = createRegion(2, 2);
    const newA = createRegion(0, 3);
    state.begin(first);
    state.append({ identity: first, regions: [oldA, oldB] });
    state.begin(second, {
      viewport: { x: 0, y: 0, width: 4, height: 2 },
      sourceRevision: "1",
      scaleKey: "1",
      quality: "interactive",
      outputTileSize: 1,
    });
    const partial = {
      identity: second,
      regions: [newA],
      continuation: { isRenderContinuation: true, identity: second } as const,
    };
    state.append(partial);
    state.applyProvisional(partial);

    const commit = state.append({ identity: second, regions: [] });

    expect(commit?.removedBounds).toEqual([oldB.bounds]);
    expect(state.visibleFrame?.regions).toEqual([newA]);
  });
});
