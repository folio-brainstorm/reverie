import type { CanvasRendererDiagnosticsSnapshot } from "@reverie/canvas-renderer";

/** One completed render call captured by the demo in sequence order. */
export interface DiagnosticsHistorySample {
  readonly sequence: number;
  readonly snapshot: CanvasRendererDiagnosticsSnapshot;
}
