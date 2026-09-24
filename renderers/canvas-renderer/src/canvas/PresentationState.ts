import type {
  RenderRegionSet,
  RenderRequestIdentity,
} from "@reverie/core/renderer";
import type { WorldRect } from "@reverie/core";

import type { PendingFrame } from "../interfaces/presentation/PendingFrame.js";
import type { PresentationCommit } from "../interfaces/presentation/PresentationCommit.js";
import type { PresentationFrame } from "../interfaces/presentation/PresentationFrame.js";

/** Accumulates full requests while admitting explicitly validated brush regions. */
export default class PresentationState {
  private currentVisibleIdentity: RenderRequestIdentity | null = null;
  private currentVisibleRegions = new Map<
    string,
    RenderRegionSet["regions"][number]
  >();
  private currentPendingFrame: PendingFrame | null = null;

  /** Identity of the request currently accumulating output, if any. */
  get pendingIdentity(): RenderRequestIdentity | null {
    return this.currentPendingFrame?.identity ?? null;
  }

  /** Number of regions accumulated by the incomplete request. */
  get pendingRegionCount(): number {
    return this.currentPendingFrame?.regions.size ?? 0;
  }

  /** Number of regions currently retained for presentation. */
  get visibleRegionCount(): number {
    return this.currentVisibleRegions.size;
  }

  /** Retained visible regions, including validated interactive replacements. */
  get visibleFrame(): PresentationFrame | null {
    return this.currentVisibleIdentity === null
      ? null
      : {
          identity: this.currentVisibleIdentity,
          regions: [...this.currentVisibleRegions.values()],
        };
  }

  /** Cancels an incomplete request without changing the visible frame. */
  cancelPending(): void {
    this.currentPendingFrame = null;
  }

  /** Discards both an incomplete request and the visible frame. */
  discard(): void {
    this.cancelPending();
    this.currentVisibleIdentity = null;
    this.currentVisibleRegions.clear();
  }

  /** Retains cached tiles near a camera viewport to bound panning memory. */
  retainNear(viewport: WorldRect): void {
    if (this.currentVisibleIdentity === null) {
      return;
    }
    const regions = [...this.currentVisibleRegions.values()].filter(
      (region) => {
        const marginX = region.bounds.width;
        const marginY = region.bounds.height;
        return (
          region.bounds.x < viewport.x + viewport.width + marginX &&
          region.bounds.x + region.bounds.width > viewport.x - marginX &&
          region.bounds.y < viewport.y + viewport.height + marginY &&
          region.bounds.y + region.bounds.height > viewport.y - marginY
        );
      },
    );
    this.currentVisibleRegions = new Map(
      regions.map((region) => [PresentationState.getRegionKey(region), region]),
    );
  }

  /**
   * Starts a new isolated pending frame while retaining visible coverage.
   * @param identity - Request and source revision accepted by this frame.
   * @param interactiveKeys - Exact Tile-region keys allowed to appear early.
   */
  begin(
    identity: RenderRequestIdentity,
    interactiveKeys: ReadonlySet<string> = new Set(),
  ): void {
    this.currentPendingFrame = {
      identity,
      regions: new Map(),
      interactiveKeys,
    };
  }

  /**
   * Applies only explicitly hinted regions from the matching current request.
   * @param result - Incomplete Core batch to inspect for changed Tiles.
   * @returns Regions safe to patch onto the Canvas immediately.
   */
  applyInteractive(result: RenderRegionSet): RenderRegionSet["regions"] {
    const pendingFrame = this.currentPendingFrame;
    if (
      pendingFrame === null ||
      !PresentationState.hasSameIdentity(pendingFrame.identity, result.identity)
    ) {
      return [];
    }
    const regions: RenderRegionSet["regions"][number][] = [];
    for (const region of result.regions) {
      const key = PresentationState.getRegionKey(region);
      if (!pendingFrame.interactiveKeys.has(key)) {
        continue;
      }
      if (PresentationState.isVisuallyEmpty(region)) {
        continue;
      }
      this.currentVisibleRegions.set(key, region);
      regions.push(region);
    }
    if (regions.length > 0) {
      this.currentVisibleIdentity = pendingFrame.identity;
    }
    return regions;
  }

  /**
   * Accumulates a matching batch and replaces visible coverage only on completion.
   *
   * @param result - Result belonging to the request being accumulated.
   * @returns Completed replacement, or null for an incomplete or stale batch.
   */
  append(result: RenderRegionSet): PresentationCommit | null {
    const pendingFrame = this.currentPendingFrame;
    if (
      pendingFrame === null ||
      !PresentationState.hasSameIdentity(pendingFrame.identity, result.identity)
    ) {
      return null;
    }

    for (const region of result.regions) {
      pendingFrame.regions.set(PresentationState.getRegionKey(region), region);
    }
    if (result.continuation !== undefined) {
      return null;
    }

    const removedBounds = [...this.currentVisibleRegions]
      .filter(([key]) => !pendingFrame.regions.has(key))
      .map(([, region]) => region.bounds);
    this.currentVisibleRegions = pendingFrame.regions;
    this.currentVisibleIdentity = pendingFrame.identity;
    this.currentPendingFrame = null;
    return {
      frame: {
        identity: pendingFrame.identity,
        regions: [...pendingFrame.regions.values()],
      },
      removedBounds,
    };
  }

  /** Uses geometry because later LOD passes intentionally replace prior regions. */
  private static getRegionKey(region: {
    readonly bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }): string {
    const { x, y, width, height } = region.bounds;
    return `${x}:${y}:${width}:${height}`;
  }

  /** Defers transparent output until full coverage reconciliation. */
  private static isVisuallyEmpty(
    region: RenderRegionSet["regions"][number],
  ): boolean {
    for (let index = 3; index < region.pixels.length; index += 4) {
      if (region.pixels[index] !== 0) {
        return false;
      }
    }
    return true;
  }

  /** Compares all values that make one request safe to present. */
  private static hasSameIdentity(
    first: RenderRequestIdentity,
    second: RenderRequestIdentity,
  ): boolean {
    return (
      first.requestId === second.requestId &&
      first.viewportKey === second.viewportKey &&
      first.sourceRevision === second.sourceRevision
    );
  }
}
