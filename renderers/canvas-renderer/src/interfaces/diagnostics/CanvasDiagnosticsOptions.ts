/** Runtime-adjustable Canvas and Core timing collection policy. */
export interface CanvasDiagnosticsOptions {
  /** Collect stage durations in subsequent render calls and batches. */
  readonly timings?: boolean;
}
