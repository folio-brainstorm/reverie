import { describe, expect, it } from "vitest";

import type { RenderRegion } from "@reveriejs/core/rendering";
import type { RenderRequestIdentity } from "@reveriejs/core/rendering/internal";

import PresentationState from "../src/canvas/PresentationState.js";

function createRegion(x: number, red: number): RenderRegion {
  return {
    bounds: { x, y: 0, width: 2, height: 2 },
    pixels: new Uint8Array([red, 0, 0, 255]),
  };
}

describe("PresentationState", () => {
  it("reuses a larger same-revision canonical region for an interactive request", () => {
    const state = new PresentationState();
    const region: RenderRegion = {
      bounds: { x: 0, y: 0, width: 128, height: 128 },
      pixels: new Uint8Array(128 * 128 * 4).fill(255),
    };
    const full = {
      viewport: { x: 0, y: 0, width: 128, height: 128 },
      sourceRevision: "1",
      scaleKey: "0.75",
      panX: 0,
      panY: 0,
      quality: "full" as const,
      outputTileSize: 128,
      resultClass: "canonical" as const,
    };
    const interactive = {
      ...full,
      quality: "interactive" as const,
      outputTileSize: 64,
      resultClass: "approximate" as const,
    };
    state.addWarmRegions([region], full);

    expect(state.getReusableRegions(interactive)).toEqual([region]);
    const identity = {
      requestId: 1,
      viewportKey: "panned",
      sourceRevision: "1",
    };
    state.begin(identity, interactive, state.getReusableRegions(interactive));
    expect(state.append({ identity, regions: [] })?.frame.regions).toEqual([
      region,
    ]);
    expect(state.getReusableRegions(full)).toEqual([region]);
    const smallerPreview: RenderRegion = {
      ...region,
      pixels: new Uint8Array(64 * 64 * 4),
      resultClass: "approximate",
    };
    state.addWarmRegions([smallerPreview], interactive);
    expect(state.getReusableRegions(interactive)).toEqual([region]);
    expect(
      state.getReusableRegions({
        ...interactive,
        viewport: { x: 128, y: 0, width: 128, height: 128 },
      }),
    ).toEqual([]);
  });

  it("rejects stale, insufficient, and semantically incompatible retained regions", () => {
    const state = new PresentationState();
    const bounds = { x: 0, y: 0, width: 128, height: 128 };
    const canonical: RenderRegion = {
      bounds,
      pixels: new Uint8Array(32 * 32 * 4),
    };
    const approximate: RenderRegion = {
      bounds,
      pixels: new Uint8Array(128 * 128 * 4),
      resultClass: "approximate",
    };
    const context = {
      viewport: bounds,
      sourceRevision: "1",
      scaleKey: "1.02",
      panX: 0,
      panY: 0,
      quality: "interactive" as const,
      outputTileSize: 64,
      resultClass: "approximate" as const,
    };
    state.addWarmRegions([canonical], { ...context, quality: "full" });
    expect(state.getReusableRegions(context)).toEqual([]);

    state.addWarmRegions([approximate], context);
    expect(
      state.getReusableRegions({
        ...context,
        quality: "full",
        resultClass: "canonical",
        outputTileSize: 128,
      }),
    ).toEqual([]);
    expect(
      state.getReusableRegions({ ...context, sourceRevision: "2" }),
    ).toEqual([]);
  });

  it("does not use a smaller canonical result to skip full-quality output", () => {
    const state = new PresentationState();
    const region: RenderRegion = {
      bounds: { x: 0, y: 0, width: 128, height: 128 },
      pixels: new Uint8Array(64 * 64 * 4),
    };
    const context = {
      viewport: region.bounds,
      sourceRevision: "0",
      scaleKey: "0.5",
      quality: "full" as const,
      outputTileSize: 64,
      resultClass: "canonical" as const,
    };
    state.addWarmRegions([region], context);

    expect(
      state.getReusableRegions({ ...context, outputTileSize: 128 }),
    ).toEqual([]);
  });

  it("retains a smaller preview beside canonical pixels and projects the sharper region", () => {
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

    expect(state.getReusableRegions(interactive)).toEqual([canonical]);
    expect(state.getReusableRegions(full)).toEqual([canonical]);
    expect(state.getProvisionalRegions(interactive)).toEqual([canonical]);
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
      expect(state.getReusableRegions(context)).toEqual([canonical]);
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
    expect(state.getReusableRegions(interactive)).toEqual([canonical]);
    expect(state.getReusableRegions(full)).toEqual([canonical]);

    const next = { ...identity, requestId: 3, viewportKey: "next" };
    state.begin(next, interactive, state.getReusableRegions(interactive));
    expect(
      state.append({ identity: next, regions: [] })?.frame.regions,
    ).toEqual([canonical]);
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

  it("rejects a 64px cached tile projected to 193px and keeps a denser provisional tile", () => {
    const state = new PresentationState();
    const full = {
      bounds: { x: 0, y: 0, width: 256, height: 256 },
      pixels: new Uint8Array(256 * 256 * 4),
    };
    const preview = { ...full, pixels: new Uint8Array(64 * 64 * 4) };
    const context = {
      viewport: { x: 50, y: 0, width: 512, height: 512 },
      sourceRevision: "0",
      scaleKey: "0.75",
      panX: 50,
      panY: 0,
      quality: "interactive" as const,
      outputTileSize: 64,
    };
    state.addWarmRegions([preview], context);
    expect(state.getReusableRegions(context)).toEqual([]);
    expect(state.getProvisionalRegions(context)).toEqual([]);

    state.addWarmRegions([full], {
      ...context,
      quality: "full",
      outputTileSize: 256,
    });
    expect(state.getProvisionalRegions(context)).toEqual([full]);
  });

  it("accepts the two-times boundary at negative coordinates but rejects a larger projection", () => {
    const state = new PresentationState();
    const region = {
      bounds: { x: -256, y: -256, width: 256, height: 256 },
      pixels: new Uint8Array(128 * 128 * 4),
    };
    const context = {
      viewport: { x: -256.5, y: -256.5, width: 256, height: 256 },
      sourceRevision: "0",
      scaleKey: "1",
      panX: -256.5,
      panY: -256.5,
      quality: "interactive" as const,
      outputTileSize: 128,
    };
    state.addWarmRegions([region], context);
    expect(state.getReusableRegions(context)).toEqual([region]);
    expect(state.getProvisionalRegions(context)).toEqual([region]);
    expect(state.getReusableRegions({ ...context, scaleKey: "1.01" })).toEqual(
      [],
    );
    expect(
      state.getProvisionalRegions({ ...context, scaleKey: "1.01" }),
    ).toEqual([]);
  });

  it("preserves a sharper same-revision tile during provisional and completed interactive work", () => {
    const state = new PresentationState();
    const full = {
      bounds: { x: 0, y: 0, width: 256, height: 256 },
      pixels: new Uint8Array(256 * 256 * 4).fill(255),
    };
    const preview = { ...full, pixels: new Uint8Array(128 * 128 * 4).fill(80) };
    const context = {
      viewport: { x: 50, y: 0, width: 512, height: 512 },
      sourceRevision: "0",
      scaleKey: "0.75",
      panX: 50,
      panY: 0,
      quality: "interactive" as const,
      outputTileSize: 128,
    };
    const first = { requestId: 1, viewportKey: "first", sourceRevision: "0" };
    state.begin(first, { ...context, quality: "full", outputTileSize: 256 });
    state.append({ identity: first, regions: [full] });

    const second = { requestId: 2, viewportKey: "second", sourceRevision: "0" };
    const partial = {
      identity: second,
      regions: [preview],
      continuation: { isRenderContinuation: true as const, identity: second },
    };
    state.begin(second, context);
    expect(state.append(partial)).toBeNull();
    expect(state.applyProvisional(partial)).toEqual([]);
    expect(state.visibleFrame?.regions).toEqual([full]);
    expect(
      state.append({ identity: second, regions: [] })?.frame.regions,
    ).toEqual([full]);

    const third = { requestId: 3, viewportKey: "third", sourceRevision: "0" };
    const tooSmall = {
      ...full,
      pixels: new Uint8Array(64 * 64 * 4).fill(40),
    };
    state.begin(third, { ...context, outputTileSize: 64 });
    expect(
      state.append({ identity: third, regions: [tooSmall] })?.frame.regions,
    ).toEqual([full]);
  });

  it("allows a newer edited revision to replace an older sharper tile", () => {
    const state = new PresentationState();
    const full = {
      bounds: { x: 0, y: 0, width: 256, height: 256 },
      pixels: new Uint8Array(256 * 256 * 4).fill(255),
    };
    const edited = { ...full, pixels: new Uint8Array(128 * 128 * 4).fill(80) };
    const context = {
      viewport: { x: 50, y: 0, width: 512, height: 512 },
      sourceRevision: "0",
      scaleKey: "0.75",
      panX: 50,
      panY: 0,
      quality: "full" as const,
      outputTileSize: 256,
    };
    const first = { requestId: 1, viewportKey: "first", sourceRevision: "0" };
    state.begin(first, context);
    state.append({ identity: first, regions: [full] });

    const second = { requestId: 2, viewportKey: "second", sourceRevision: "1" };
    const partial = {
      identity: second,
      regions: [edited],
      continuation: { isRenderContinuation: true as const, identity: second },
    };
    state.begin(second, {
      ...context,
      sourceRevision: "1",
      quality: "interactive",
      outputTileSize: 128,
    });
    expect(state.append(partial)).toBeNull();
    expect(state.applyProvisional(partial)).toEqual([edited]);
    expect(
      state.append({ identity: second, regions: [] })?.frame.regions,
    ).toEqual([edited]);
    expect(
      state.getProvisionalRegions({ ...context, sourceRevision: "1" }),
    ).toEqual([edited]);
  });

  it("lets a newer source revision displace stale coverage even when its preview is sparse", () => {
    const state = new PresentationState();
    const full = {
      bounds: { x: 0, y: 0, width: 256, height: 256 },
      pixels: new Uint8Array(256 * 256 * 4).fill(255),
    };
    const edited = { ...full, pixels: new Uint8Array(64 * 64 * 4).fill(80) };
    const context = {
      viewport: { x: 50, y: 0, width: 512, height: 512 },
      sourceRevision: "0",
      scaleKey: "0.75",
      panX: 50,
      panY: 0,
      quality: "full" as const,
      outputTileSize: 256,
    };
    const first = { requestId: 1, viewportKey: "first", sourceRevision: "0" };
    state.begin(first, context);
    state.append({ identity: first, regions: [full] });
    const second = { requestId: 2, viewportKey: "second", sourceRevision: "1" };
    const nextContext = {
      ...context,
      sourceRevision: "1",
      quality: "interactive" as const,
      outputTileSize: 64,
    };
    state.addWarmRegions([edited], nextContext);
    expect(state.getProvisionalRegions(nextContext)).toEqual([edited]);
    const partial = {
      identity: second,
      regions: [edited],
      continuation: { isRenderContinuation: true as const, identity: second },
    };
    state.begin(second, nextContext);
    state.append(partial);
    expect(state.applyProvisional(partial)).toEqual([edited]);
    expect(
      state.append({ identity: second, regions: [] })?.frame.regions,
    ).toEqual([edited]);
  });
});
