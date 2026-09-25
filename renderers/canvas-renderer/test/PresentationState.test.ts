import { describe, expect, it } from "vitest";

import type {
  RenderRegion,
  RenderRequestIdentity,
} from "@reverie/core/renderer";

import PresentationState from "../src/canvas/PresentationState.js";

function createRegion(x: number, red: number): RenderRegion {
  return {
    bounds: { x, y: 0, width: 2, height: 2 },
    pixels: new Uint8Array([red, 0, 0, 255]),
  };
}

describe("PresentationState", () => {
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
