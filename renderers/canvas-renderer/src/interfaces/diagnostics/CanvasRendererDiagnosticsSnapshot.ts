import type {
  RenderingCoreDiagnosticsSnapshot,
  TimingMetric,
} from "@reverie/core/renderer";

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
    readonly presentationDurationMs?: TimingMetric;
    readonly uploadDurationMs?: TimingMetric;
    readonly drawDurationMs?: TimingMetric;
  };
}
