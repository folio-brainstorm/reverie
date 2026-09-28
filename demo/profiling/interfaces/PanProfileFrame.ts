import type { CanvasRendererDiagnosticsSnapshot } from "@reveriejs/canvas-renderer";

/** One actual renderer call, including its request counters and work measurements. */
export interface PanProfileFrame {
  sequence: number;
  phase: string;
  atMs: number;
  panX: number;
  visible: number;
  newlyVisible: number;
  overlapping: number;
  metrics: Record<string, number>;
  snapshot: CanvasRendererDiagnosticsSnapshot;
}
