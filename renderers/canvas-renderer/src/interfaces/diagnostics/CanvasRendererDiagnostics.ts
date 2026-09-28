import type { CanvasRendererDiagnosticsSnapshot } from "./CanvasRendererDiagnosticsSnapshot.js";

/** Public read-only access to a Canvas renderer's diagnostic measurements. */
export interface CanvasRendererDiagnostics {
  /** Returns a detached snapshot of the latest call and lifetime counters. */
  getSnapshot(): CanvasRendererDiagnosticsSnapshot;
}
