import type { RenderingCore } from "@reverie/core/renderer";
import type { TimingMetric } from "@reverie/core/renderer";
import type { RenderQualityMode } from "@reverie/core/renderer";

import type { CanvasRendererDiagnosticsSnapshot } from "../interfaces/diagnostics/CanvasRendererDiagnosticsSnapshot.js";
import type { CoveragePlan } from "../interfaces/prefetch/CoveragePlan.js";

const WINDOW_SIZE = 60;

/** Owns Canvas measurements while Core retains platform-independent metrics. */
export default class CanvasDiagnostics {
  private readonly core: RenderingCore;
  private timingsEnabled: boolean;
  private readonly presentationSamples: number[] = [];
  private readonly uploadSamples: number[] = [];
  private readonly drawSamples: number[] = [];
  private presentedCount = 0;
  private removedCount = 0;
  private visibleCount = 0;
  private pendingCount = 0;
  private uploadedRegionCount = 0;
  private drawnRegionCount = 0;
  private rgbaIdentityReuseCount = 0;
  private rgbaComparisonCount = 0;
  private rgbaComparedByteCount = 0;
  private completionDeltaRegionCount = 0;
  private skippedAlreadyPresentedRegionCount = 0;
  private presentationDurationMs = 0;
  private uploadDurationMs = 0;
  private drawDurationMs = 0;
  private requestedViewRenderCount = 0;
  private executedViewRenderCount = 0;
  private coalescedViewRenderCount = 0;
  private interactiveRenderCount = 0;
  private fullRenderCount = 0;
  private qualityMode: RenderQualityMode = "full";
  private visibleTileCount = 0;
  private warmTileCount = 0;
  private retainedTileCount = 0;
  private presentationHitCount = 0;
  private generationHitCount = 0;
  private provisionalRegionCount = 0;
  private visibleMissCount = 0;
  private warmMissCount = 0;
  private coveragePlan: CoveragePlan | null = null;
  private hasHighCoveragePressure = false;
  private interactiveOutputTileSize: number | null = null;
  private missingVisibleCount = 0;
  private missingWarmCount = 0;
  private prefetchRequestedCount = 0;
  private prefetchCompletedCount = 0;
  private warmContinuationExecutedCount = 0;
  private warmContinuationDeferredCount = 0;

  /** Combines one Core's counters with opt-in Canvas measurements. */
  constructor(core: RenderingCore, timingsEnabled: boolean) {
    this.core = core;
    this.timingsEnabled = timingsEnabled;
  }

  /** Whether backend calls should collect high-resolution durations. */
  get hasTimings(): boolean {
    return this.timingsEnabled;
  }

  /** Starts or stops timing collection with a fresh rolling sample window. */
  setTimingsEnabled(enabled: boolean): void {
    if (this.timingsEnabled === enabled) {
      return;
    }
    this.timingsEnabled = enabled;
    this.presentationSamples.length = 0;
    this.uploadSamples.length = 0;
    this.drawSamples.length = 0;
  }

  /** Clears the latest-call values before a Canvas render. */
  beginRender(quality: RenderQualityMode): void {
    this.qualityMode = quality;
    if (quality === "interactive") {
      this.interactiveRenderCount += 1;
    } else {
      this.fullRenderCount += 1;
    }
    this.presentedCount = 0;
    this.removedCount = 0;
    this.uploadedRegionCount = 0;
    this.drawnRegionCount = 0;
    this.rgbaIdentityReuseCount = 0;
    this.rgbaComparisonCount = 0;
    this.rgbaComparedByteCount = 0;
    this.completionDeltaRegionCount = 0;
    this.skippedAlreadyPresentedRegionCount = 0;
    this.presentationDurationMs = 0;
    this.uploadDurationMs = 0;
    this.drawDurationMs = 0;
    this.missingVisibleCount = 0;
    this.missingWarmCount = 0;
    this.warmContinuationExecutedCount = 0;
    this.warmContinuationDeferredCount = 0;
  }

  /** Publishes the bounded geometry and selected output for the latest frame. */
  setCoveragePolicy(
    plan: CoveragePlan,
    hasPressure: boolean,
    outputTileSize: number,
  ): void {
    this.coveragePlan = plan;
    this.hasHighCoveragePressure = hasPressure;
    this.interactiveOutputTileSize =
      this.qualityMode === "interactive" ? outputTileSize : null;
  }

  /** Records one host camera request and whether it joined a pending frame. */
  recordViewRequest(isCoalesced: boolean): void {
    this.requestedViewRenderCount += 1;
    if (isCoalesced) {
      this.coalescedViewRenderCount += 1;
    }
  }

  /** Records a frame that executed the latest requested camera state. */
  recordViewExecution(): void {
    this.executedViewRenderCount += 1;
  }

  /** Receives measured cached results by actual viewport zone. */
  setZoneState(visible: number, warm: number, retained: number): void {
    this.visibleTileCount = visible;
    this.warmTileCount = warm;
    this.retainedTileCount = retained;
  }

  /** Records reuse and new visible results from one active viewport batch. */
  recordCoverage(
    presentationHits: number,
    generationHits: number,
    provisionalRegions: number,
    visibleMisses: number,
  ): void {
    this.presentationHitCount += presentationHits;
    this.generationHitCount += generationHits;
    this.provisionalRegionCount += provisionalRegions;
    this.visibleMissCount += visibleMisses;
    this.missingVisibleCount += visibleMisses;
  }

  /** Records generated results from a lower-priority warm batch. */
  recordWarmMisses(count: number): void {
    this.warmMissCount += count;
    this.missingWarmCount += count;
  }

  /** Counts real Core candidates and completed pixels from a warm batch. */
  recordPrefetch(requested: number, completed: number): void {
    this.prefetchRequestedCount += requested;
    this.prefetchCompletedCount += completed;
  }

  /** Counts an admitted lower-priority Core batch in this render call. */
  recordWarmExecution(): void {
    this.warmContinuationExecutedCount += 1;
  }

  /** Counts warm work retained for a later frame due to host headroom. */
  recordWarmDeferral(): void {
    this.warmContinuationDeferredCount += 1;
  }

  /** Commits successful render-call durations to the rolling window. */
  endRender(): void {
    if (!this.timingsEnabled) {
      return;
    }
    CanvasDiagnostics.record(
      this.presentationSamples,
      this.presentationDurationMs,
    );
    CanvasDiagnostics.record(this.uploadSamples, this.uploadDurationMs);
    CanvasDiagnostics.record(this.drawSamples, this.drawDurationMs);
  }

  /** Records the current presentation coverage and pending partial output. */
  setRegionState(visibleCount: number, pendingCount: number): void {
    this.visibleCount = visibleCount;
    this.pendingCount = pendingCount;
  }

  /** Counts regions drawn to the target during this call. */
  recordPresented(count: number): void {
    this.presentedCount += count;
    this.drawnRegionCount += count;
  }

  /** Counts regions removed from the current viewport during this call. */
  recordRemoved(count: number): void {
    this.removedCount += count;
  }

  /** Counts fresh pixel uploads, excluding byte-identical reused surfaces. */
  recordUpload(durationMs: number): void {
    this.uploadedRegionCount += 1;
    this.uploadDurationMs += durationMs;
  }

  /** Counts a constant-time hit on a previously validated immutable result. */
  recordIdentityReuse(): void {
    this.rgbaIdentityReuseCount += 1;
  }

  /** Counts one fallback comparison and its logical byte length. */
  recordPixelComparison(bytes: number): void {
    this.rgbaComparisonCount += 1;
    this.rgbaComparedByteCount += bytes;
  }

  /** Counts completed regions that still required target Canvas drawing. */
  recordCompletionDelta(count: number): void {
    this.completionDeltaRegionCount += count;
  }

  /** Counts regions already painted under the current Camera projection. */
  recordAlreadyPresented(count: number): void {
    this.skippedAlreadyPresentedRegionCount += count;
  }

  /** Adds measured Canvas draw time for a rendered region. */
  recordDraw(durationMs: number): void {
    this.drawDurationMs += durationMs;
  }

  /** Adds time spent in a backend presentation operation. */
  recordPresentation(durationMs: number): void {
    this.presentationDurationMs += durationMs;
  }

  /** Returns frozen, detached data without sharing mutable engine state. */
  getSnapshot(): CanvasRendererDiagnosticsSnapshot {
    const core = this.core.getDiagnosticsSnapshot();
    const presentationDurationMs = CanvasDiagnostics.metric(
      this.presentationSamples,
    );
    const uploadDurationMs = CanvasDiagnostics.metric(this.uploadSamples);
    const drawDurationMs = CanvasDiagnostics.metric(this.drawSamples);
    return Object.freeze({
      ...core,
      regions: Object.freeze({
        ...core.regions,
        presentedCount: this.presentedCount,
        removedCount: this.removedCount,
        visibleCount: this.visibleCount,
        pendingCount: this.pendingCount,
      }),
      presentation: Object.freeze({
        uploadedRegionCount: this.uploadedRegionCount,
        drawnRegionCount: this.drawnRegionCount,
        rgbaIdentityReuseCount: this.rgbaIdentityReuseCount,
        rgbaComparisonCount: this.rgbaComparisonCount,
        rgbaComparedByteCount: this.rgbaComparedByteCount,
        completionDeltaRegionCount: this.completionDeltaRegionCount,
        skippedAlreadyPresentedRegionCount:
          this.skippedAlreadyPresentedRegionCount,
        ...(presentationDurationMs === undefined
          ? {}
          : { presentationDurationMs }),
        ...(uploadDurationMs === undefined ? {} : { uploadDurationMs }),
        ...(drawDurationMs === undefined ? {} : { drawDurationMs }),
      }),
      scheduling: Object.freeze({
        requestedCount: this.requestedViewRenderCount,
        executedCount: this.executedViewRenderCount,
        coalescedCount: this.coalescedViewRenderCount,
      }),
      zones: Object.freeze({
        visibleCount: this.visibleTileCount,
        warmCount: this.warmTileCount,
        retainedCount: this.retainedTileCount,
      }),
      reuse: Object.freeze({
        presentationHitCount: this.presentationHitCount,
        generationHitCount: this.generationHitCount,
        provisionalRegionCount: this.provisionalRegionCount,
        visibleMissCount: this.visibleMissCount,
        warmMissCount: this.warmMissCount,
      }),
      interaction: Object.freeze({
        mode: this.qualityMode,
        interactiveRenderCount: this.interactiveRenderCount,
        fullRenderCount: this.fullRenderCount,
      }),
      coverage: Object.freeze({
        renderMarginTiles: this.coveragePlan?.renderMarginTiles ?? 0,
        retentionMarginTiles: this.coveragePlan?.retainMarginTiles ?? 0,
        cameraVelocityPixelsPerMs: this.coveragePlan?.velocityPixelsPerMs ?? 0,
        directionalLookaheadTiles: this.coveragePlan?.lookaheadTiles ?? 0,
        directionX: this.coveragePlan?.directionX ?? 0,
        directionY: this.coveragePlan?.directionY ?? 0,
        pressure: this.hasHighCoveragePressure ? "high" : "normal",
        interactiveOutputTileSize: this.interactiveOutputTileSize,
        missingVisibleCount: this.missingVisibleCount,
        missingWarmCount: this.missingWarmCount,
        prefetchRequestedCount: this.prefetchRequestedCount,
        prefetchCompletedCount: this.prefetchCompletedCount,
        warmContinuationExecutedCount: this.warmContinuationExecutedCount,
        warmContinuationDeferredCount: this.warmContinuationDeferredCount,
      }),
    });
  }

  private static record(samples: number[], durationMs: number): void {
    if (samples.length === WINDOW_SIZE) {
      samples.shift();
    }
    samples.push(durationMs);
  }

  private static metric(samples: readonly number[]): TimingMetric | undefined {
    if (samples.length === 0) {
      return undefined;
    }
    return Object.freeze({
      current: samples[samples.length - 1] ?? 0,
      average:
        samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
      max: Math.max(...samples),
    });
  }
}
