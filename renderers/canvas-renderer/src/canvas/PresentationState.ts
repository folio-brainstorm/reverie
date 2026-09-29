import type { RenderRegionSet } from "@reveriejs/core/rendering";
import type { RenderRequestIdentity } from "@reveriejs/core/rendering/internal";
import type { WorldRect } from "@reveriejs/core";
import type { TileCoord } from "@reveriejs/core/rendering";

import type { CachedPresentationRegion } from "../interfaces/presentation/CachedPresentationRegion.js";
import type { PendingFrame } from "../interfaces/presentation/PendingFrame.js";
import type { PresentationCacheContext } from "../interfaces/presentation/PresentationCacheContext.js";
import type { PresentationCommit } from "../interfaces/presentation/PresentationCommit.js";
import type { PresentationFrame } from "../interfaces/presentation/PresentationFrame.js";

import {
  getPresentationScale,
  hasSufficientPresentationDensity,
} from "./PresentationDensity.js";

/** Accumulates requests while admitting safe completed regions provisionally. */
export default class PresentationState {
  private currentVisibleIdentity: RenderRequestIdentity | null = null;
  private currentVisibleRegions = new Map<
    string,
    RenderRegionSet["regions"][number]
  >();
  private currentVisibleRevisions = new Map<string, string>();
  private currentPendingFrame: PendingFrame | null = null;
  private readonly cachedRegions = new Map<string, CachedPresentationRegion>();

  /** Identity of the request currently accumulating output, if any. */
  get pendingIdentity(): RenderRequestIdentity | null {
    return this.currentPendingFrame?.identity ?? null;
  }

  /** Effective output resolution required by the unfinished request. */
  get pendingOutputTileSize(): number | null {
    return this.currentPendingFrame?.cacheContext?.outputTileSize ?? null;
  }

  /** Pixel semantics required by the unfinished request. */
  get pendingResultClass(): "canonical" | "approximate" | null {
    const context = this.currentPendingFrame?.cacheContext;
    return context === undefined ? null : (context.resultClass ?? "canonical");
  }

  /** Number of regions accumulated by the incomplete request. */
  get pendingRegionCount(): number {
    return this.currentPendingFrame?.regions.size ?? 0;
  }

  /** Number of regions currently retained for presentation. */
  get visibleRegionCount(): number {
    return this.currentVisibleRegions.size;
  }

  /** Number of final pixel results held inside the current retention boundary. */
  get retainedRegionCount(): number {
    return this.cachedRegions.size;
  }

  /** Retained visible regions, including safe provisional replacements. */
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
    this.currentVisibleRevisions.clear();
    this.cachedRegions.clear();
  }

  /** Invalidates reusable pixels while leaving the last visible frame as fallback. */
  clearRetained(): void {
    this.cachedRegions.clear();
  }

  /** Clears the display frame while preserving nearby reusable results. */
  clearVisible(): void {
    this.cancelPending();
    this.currentVisibleIdentity = null;
    this.currentVisibleRegions.clear();
    this.currentVisibleRevisions.clear();
  }

  /**
   * Retains renderer results in a larger boundary than the warm margin.
   * @param viewport - Current camera area in world pixels.
   * @param margin - Retention distance in world pixels on each side.
   */
  retainNear(viewport: WorldRect, margin: number): void {
    for (const [key, cached] of this.cachedRegions) {
      if (
        !PresentationState.intersects(cached.region.bounds, viewport, margin)
      ) {
        this.cachedRegions.delete(key);
      }
    }
    this.currentVisibleRegions = new Map(
      [...this.currentVisibleRegions].filter(([, region]) =>
        PresentationState.intersects(region.bounds, viewport, margin),
      ),
    );
    this.currentVisibleRevisions = new Map(
      [...this.currentVisibleRevisions].filter(([key]) =>
        this.currentVisibleRegions.has(key),
      ),
    );
  }

  /**
   * Reuses same-revision pixels at sufficient actual presentation density.
   * Canonical pixels may satisfy approximate interactive work; approximate
   * pixels cannot satisfy canonical work. Full-quality work also requires at
   * least its requested output size, even when a smaller tile would present
   * within the interactive 2x density limit.
   * @param context - Source, viewport, and output quality required for reuse.
   * @returns Final pixels that the next Core request may skip.
   */
  getReusableRegions(
    context: PresentationCacheContext,
  ): RenderRegionSet["regions"] {
    const reusable = new Map<string, CachedPresentationRegion>();
    for (const cached of this.cachedRegions.values()) {
      if (
        cached.sourceRevision !== context.sourceRevision ||
        (context.quality === "full" &&
          cached.outputTileSize < context.outputTileSize) ||
        !hasSufficientPresentationDensity(cached.region, context) ||
        (context.resultClass !== "approximate" &&
          cached.region.resultClass === "approximate") ||
        !PresentationState.intersects(cached.region.bounds, context.viewport, 0)
      ) {
        continue;
      }
      const key = PresentationState.getRegionKey(cached.region);
      const previous = reusable.get(key);
      if (
        previous === undefined ||
        PresentationState.prefersProjection(cached, previous, context)
      ) {
        reusable.set(key, cached);
      }
    }
    return [...reusable.values()].map((cached) => cached.region);
  }

  /** Returns same-source pixels that can be projected as temporary coverage. */
  getProvisionalRegions(
    context: PresentationCacheContext,
  ): RenderRegionSet["regions"] {
    const selected = new Map<string, CachedPresentationRegion>();
    for (const cached of this.cachedRegions.values()) {
      const key = PresentationState.getRegionKey(cached.region);
      if (
        cached.sourceRevision !== context.sourceRevision ||
        (!hasSufficientPresentationDensity(cached.region, context) &&
          !this.hasOlderVisibleRegion(key, context.sourceRevision)) ||
        !PresentationState.intersects(cached.region.bounds, context.viewport, 0)
      ) {
        continue;
      }
      const previous = selected.get(key);
      if (
        previous === undefined ||
        PresentationState.prefersProjection(cached, previous, context)
      ) {
        selected.set(key, cached);
      }
    }
    return [...selected.values()].map((cached) => cached.region);
  }

  /**
   * Retains at most a regular and a recent interactive result per coordinate.
   * Interactive Raster results are canonical too, but need their own size slot.
   * @param regions - Completed warm-zone pixel results.
   * @param context - Validity metadata attached to those results.
   */
  addWarmRegions(
    regions: RenderRegionSet["regions"],
    context: PresentationCacheContext,
  ): void {
    for (const region of regions) {
      const outputTileSize = Math.sqrt(region.pixels.length / 4);
      const key = `${PresentationState.getRegionKey(region)}:${context.quality}`;
      const cached = this.cachedRegions.get(key);
      if (
        cached?.sourceRevision === context.sourceRevision &&
        (cached.outputTileSize > outputTileSize ||
          (cached.outputTileSize === outputTileSize &&
            cached.region.resultClass !== "approximate" &&
            region.resultClass === "approximate"))
      ) {
        continue;
      }
      this.cachedRegions.set(key, {
        region,
        sourceRevision: context.sourceRevision,
        outputTileSize,
      });
    }
  }

  /**
   * Keeps unaffected results after a precisely located source edit.
   * @param sourceRevision - New renderer source revision.
   * @param changedTiles - All source Tiles touched by the edit.
   * @param tileSize - Source Tile edge length in world pixels.
   */
  retainSourceChanges(
    sourceRevision: string,
    changedTiles: readonly TileCoord[],
    tileSize: number,
  ): void {
    if (changedTiles.length === 0) {
      this.cachedRegions.clear();
      return;
    }
    const changedKeys = new Set(
      changedTiles.map(
        ({ x, y }) => `${x * tileSize}:${y * tileSize}:${tileSize}:${tileSize}`,
      ),
    );
    for (const [key, cached] of this.cachedRegions) {
      if (changedKeys.has(PresentationState.getRegionKey(cached.region))) {
        this.cachedRegions.delete(key);
      } else {
        this.cachedRegions.set(key, { ...cached, sourceRevision });
      }
    }
  }

  /**
   * Counts cached nonempty results in the actual visible, warm, and retained zones.
   * @param viewport - Current visible area in world pixels.
   * @param warmViewport - Visible area expanded to the render margin.
   * @returns Counts of retained renderer results by zone.
   */
  getZoneCounts(
    viewport: WorldRect,
    warmViewport: WorldRect,
  ): { visible: number; warm: number; retained: number } {
    let visible = 0;
    let warm = 0;
    let retained = 0;
    const counted = new Set<string>();
    for (const { region } of this.cachedRegions.values()) {
      const key = PresentationState.getRegionKey(region);
      if (counted.has(key)) {
        continue;
      }
      counted.add(key);
      if (PresentationState.intersects(region.bounds, viewport, 0)) {
        visible += 1;
      } else if (PresentationState.intersects(region.bounds, warmViewport, 0)) {
        warm += 1;
      } else {
        retained += 1;
      }
    }
    return { visible, warm, retained };
  }

  /**
   * Starts a new isolated pending frame while retaining visible coverage.
   * @param identity - Request and source revision accepted by this frame.
   * @param cacheContext - Validity metadata for completed pixels, when retained.
   * @param reusableRegions - Renderer pixels already valid for this request.
   */
  begin(
    identity: RenderRequestIdentity,
    cacheContext?: PresentationCacheContext,
    reusableRegions: RenderRegionSet["regions"] = [],
  ): void {
    this.currentPendingFrame = {
      identity,
      regions: new Map(
        reusableRegions.map((region) => [
          PresentationState.getRegionKey(region),
          region,
        ]),
      ),
      ...(cacheContext === undefined ? {} : { cacheContext }),
    };
  }

  /**
   * Patches completed nonempty regions from the current incomplete request.
   * Removal remains deferred until full request reconciliation.
   * @param result - Incomplete Core batch belonging to the current request.
   * @returns Regions safe to patch onto the Canvas immediately.
   */
  applyProvisional(result: RenderRegionSet): RenderRegionSet["regions"] {
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
      const context = pendingFrame.cacheContext;
      if (
        context === undefined ||
        !PresentationState.intersects(region.bounds, context.viewport, 0) ||
        !Object.values(region.bounds).every(Number.isFinite) ||
        region.bounds.width <= 0 ||
        region.bounds.height <= 0 ||
        region.pixels.length !== context.outputTileSize ** 2 * 4
      ) {
        continue;
      }
      if (PresentationState.isVisuallyEmpty(region)) {
        continue;
      }
      if (
        (!hasSufficientPresentationDensity(region, context) &&
          !this.hasOlderVisibleRegion(key, context.sourceRevision)) ||
        this.shouldKeepVisibleRegion(key, region, context)
      ) {
        continue;
      }
      this.currentVisibleRegions.set(key, region);
      this.currentVisibleRevisions.set(key, context.sourceRevision);
      this.addWarmRegions([region], context);
      regions.push(region);
    }
    if (regions.length > 0) {
      this.currentVisibleIdentity = pendingFrame.identity;
    }
    return regions;
  }

  /**
   * Accumulates a matching batch and reconciles visible coverage on completion.
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
    if (pendingFrame.cacheContext !== undefined) {
      // Completed pixels survive cancellation, including transparent results
      // whose visible removal is deferred until request reconciliation.
      this.addWarmRegions(result.regions, pendingFrame.cacheContext);
    }
    if (result.continuation !== undefined) {
      return null;
    }

    const removedBounds = [...this.currentVisibleRegions]
      .filter(([key]) => !pendingFrame.regions.has(key))
      .map(([, region]) => region.bounds);
    const cacheContext = pendingFrame.cacheContext;
    const nextRegions = new Map(pendingFrame.regions);
    if (cacheContext !== undefined) {
      for (const [key, region] of nextRegions) {
        if (this.shouldKeepVisibleRegion(key, region, cacheContext)) {
          const visible = this.currentVisibleRegions.get(key);
          if (visible !== undefined) nextRegions.set(key, visible);
        }
      }
    }
    if (cacheContext !== undefined) {
      for (const [key, cached] of this.cachedRegions) {
        if (
          PresentationState.intersects(
            cached.region.bounds,
            cacheContext.viewport,
            0,
          ) &&
          !pendingFrame.regions.has(
            PresentationState.getRegionKey(cached.region),
          )
        ) {
          this.cachedRegions.delete(key);
        }
      }
      this.addWarmRegions([...pendingFrame.regions.values()], cacheContext);
    }
    this.currentVisibleRegions = nextRegions;
    this.currentVisibleRevisions = new Map(
      [...nextRegions.keys()].map((key) => [
        key,
        pendingFrame.identity.sourceRevision,
      ]),
    );
    this.currentVisibleIdentity = pendingFrame.identity;
    this.currentPendingFrame = null;
    return {
      frame: {
        identity: pendingFrame.identity,
        regions: [...nextRegions.values()],
      },
      removedBounds,
    };
  }

  /** Prefers the densest valid coverage, then canonical pixels at equal size. */
  private static prefersProjection(
    candidate: CachedPresentationRegion,
    previous: CachedPresentationRegion,
    context: PresentationCacheContext,
  ): boolean {
    const isCandidateApproximate =
      candidate.region.resultClass === "approximate";
    const isPreviousApproximate = previous.region.resultClass === "approximate";
    const candidateScale = getPresentationScale(candidate.region, context);
    const previousScale = getPresentationScale(previous.region, context);
    if (candidateScale !== previousScale) {
      return candidateScale < previousScale;
    }
    if (isCandidateApproximate !== isPreviousApproximate)
      return !isCandidateApproximate;
    return false;
  }

  /** Finds stale coverage that must yield to completed newer source pixels. */
  private hasOlderVisibleRegion(key: string, sourceRevision: string): boolean {
    return (
      this.currentVisibleRegions.has(key) &&
      this.currentVisibleRevisions.get(key) !== sourceRevision
    );
  }

  /** Preserves sharper pixels only when their source revision still matches. */
  private shouldKeepVisibleRegion(
    key: string,
    candidate: RenderRegionSet["regions"][number],
    context: PresentationCacheContext,
  ): boolean {
    if (this.currentVisibleRevisions.get(key) !== context.sourceRevision)
      return false;
    const visible = this.currentVisibleRegions.get(key);
    if (
      visible === undefined ||
      !hasSufficientPresentationDensity(visible, context)
    )
      return false;
    const visibleScale = getPresentationScale(visible, context);
    const candidateScale = getPresentationScale(candidate, context);
    return (
      visibleScale < candidateScale ||
      (visibleScale === candidateScale &&
        visible.resultClass !== "approximate" &&
        candidate.resultClass === "approximate")
    );
  }

  /** Uses half-open intersections so a Tile touching an edge is outside it. */
  private static intersects(
    bounds: WorldRect,
    viewport: WorldRect,
    margin: number,
  ): boolean {
    return (
      bounds.x < viewport.x + viewport.width + margin &&
      bounds.x + bounds.width > viewport.x - margin &&
      bounds.y < viewport.y + viewport.height + margin &&
      bounds.y + bounds.height > viewport.y - margin
    );
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
