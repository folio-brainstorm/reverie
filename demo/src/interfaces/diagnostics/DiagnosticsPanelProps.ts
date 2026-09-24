import type DemoDiagnosticsRecorder from "../../DemoDiagnosticsRecorder";

/** Demo-owned history source for the public renderer snapshots on display. */
export interface DiagnosticsPanelProps {
  readonly recorder: DemoDiagnosticsRecorder;
}
