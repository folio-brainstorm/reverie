import type { RenderingCore } from "@reverie/core/renderer";
import type { TimingMetric } from "@reverie/core/renderer";

import type { CanvasRendererDiagnosticsSnapshot } from "../interfaces/diagnostics/CanvasRendererDiagnosticsSnapshot.js";

const WINDOW_SIZE = 60;

/** Owns Canvas measurements while Core retains platform-independent metrics. */
export default class CanvasDiagnostics {
  private readonly core: RenderingCore;
  private readonly timingsEnabled: boolean;
  private readonly presentationSamples: number[] = [];
  private readonly uploadSamples: number[] = [];
  private readonly drawSamples: number[] = [];
  private presentedCount = 0;
  private removedCount = 0;
  private visibleCount = 0;
  private pendingCount = 0;
  private uploadedRegionCount = 0;
  private drawnRegionCount = 0;
  private presentationDurationMs = 0;
  private uploadDurationMs = 0;
  private drawDurationMs = 0;

  /** Combines one Core's counters with opt-in Canvas measurements. */
  constructor(core: RenderingCore, timingsEnabled: boolean) {
    this.core = core;
    this.timingsEnabled = timingsEnabled;
  }

  /** Whether backend calls should collect high-resolution durations. */
  get hasTimings(): boolean {
    return this.timingsEnabled;
  }

  /** Clears the latest-call values before a Canvas render. */
  beginRender(): void {
    this.presentedCount = 0;
    this.removedCount = 0;
    this.uploadedRegionCount = 0;
    this.drawnRegionCount = 0;
    this.presentationDurationMs = 0;
    this.uploadDurationMs = 0;
    this.drawDurationMs = 0;
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
        ...(presentationDurationMs === undefined
          ? {}
          : { presentationDurationMs }),
        ...(uploadDurationMs === undefined ? {} : { uploadDurationMs }),
        ...(drawDurationMs === undefined ? {} : { drawDurationMs }),
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
