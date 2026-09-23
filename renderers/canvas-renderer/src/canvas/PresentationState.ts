import type {
  RenderRegionSet,
  RenderRequestIdentity,
} from "@reverie/core/renderer";
import type { WorldRect } from "@reverie/core";

import type { PendingFrame } from "../interfaces/presentation/PendingFrame.js";
import type { PresentationFrame } from "../interfaces/presentation/PresentationFrame.js";

/** Tracks progressive render batches and the reusable visible tile cache. */
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

  /** Last complete frame that is safe to display, if one has been produced. */
  get visibleFrame(): PresentationFrame | null {
    return this.currentVisibleIdentity === null
      ? null
      : {
          identity: this.currentVisibleIdentity,
          regions: [...this.currentVisibleRegions.values()],
        };
  }

  /** Discards unfinished work and cached pixels after a full invalidation. */
  invalidate(): void {
    this.currentPendingFrame = null;
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

  /** Starts a new isolated pending frame while retaining the visible frame. */
  begin(identity: RenderRequestIdentity): void {
    this.currentPendingFrame = {
      identity,
    };
  }

  /**
   * Merges one matching Core batch into the visible tile cache immediately.
   *
   * @param result - Result belonging to the request being accumulated.
   * @returns Whether the batch matched the active request.
   */
  append(result: RenderRegionSet): boolean {
    const pendingFrame = this.currentPendingFrame;
    if (
      pendingFrame === null ||
      !PresentationState.hasSameIdentity(pendingFrame.identity, result.identity)
    ) {
      return false;
    }

    for (const region of result.regions) {
      this.currentVisibleRegions.set(
        PresentationState.getRegionKey(region),
        region,
      );
    }
    this.currentVisibleIdentity = pendingFrame.identity;
    if (result.continuation === undefined) {
      this.currentPendingFrame = null;
    }
    return true;
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
