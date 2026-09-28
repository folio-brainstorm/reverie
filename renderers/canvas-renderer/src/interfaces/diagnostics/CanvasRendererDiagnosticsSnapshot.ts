import type {
  RenderingCoreDiagnosticsSnapshot,
  TimingMetric,
} from "@reveriejs/core/rendering";

/** Detached measurements for the latest Canvas render call and its core. */
export interface CanvasRendererDiagnosticsSnapshot extends RenderingCoreDiagnosticsSnapshot {
  readonly regions: RenderingCoreDiagnosticsSnapshot["regions"] & {
    readonly presentedCount: number;
    readonly removedCount: number;
    readonly visibleCount: number;
    readonly pendingCount: number;
  };
  readonly presentation: {
    readonly uploadedRegionCount: number;
    readonly drawnRegionCount: number;
    readonly rgbaIdentityReuseCount: number;
    readonly rgbaComparisonCount: number;
    readonly rgbaComparedByteCount: number;
    readonly completionDeltaRegionCount: number;
    readonly skippedAlreadyPresentedRegionCount: number;
    readonly presentationDurationMs?: TimingMetric;
    readonly uploadDurationMs?: TimingMetric;
    readonly drawDurationMs?: TimingMetric;
  };
  /** Host camera render requests accepted by the Web scheduler. */
  readonly scheduling: {
    readonly requestedCount: number;
    readonly executedCount: number;
    readonly coalescedCount: number;
  };
  /** Nonempty renderer results currently held in each viewport zone. */
  readonly zones: {
    readonly visibleCount: number;
    readonly warmCount: number;
    readonly retainedCount: number;
  };
  /** Cumulative region counts gathered during render passes without cache scans. */
  readonly reuse: {
    readonly presentationHitCount: number;
    readonly generationHitCount: number;
    readonly provisionalRegionCount: number;
    readonly visibleMissCount: number;
    readonly warmMissCount: number;
  };
  readonly interaction: {
    readonly mode: "full" | "interactive";
    readonly interactiveRenderCount: number;
    readonly fullRenderCount: number;
  };
  /** Latest bounded coverage policy and cumulative speculative work. */
  readonly coverage: {
    readonly renderMarginTiles: number;
    readonly retentionMarginTiles: number;
    readonly cameraVelocityPixelsPerMs: number;
    readonly directionalLookaheadTiles: number;
    readonly directionX: -1 | 0 | 1;
    readonly directionY: -1 | 0 | 1;
    readonly pressure: "normal" | "high";
    readonly interactiveOutputTileSize: number | null;
    /** New visible results discovered in the latest visible batch. */
    readonly missingVisibleCount: number;
    /** New warm results discovered in the latest warm batch. */
    readonly missingWarmCount: number;
    readonly prefetchRequestedCount: number;
    readonly prefetchCompletedCount: number;
    readonly warmContinuationExecutedCount: number;
    readonly warmContinuationDeferredCount: number;
  };
}
