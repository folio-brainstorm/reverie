import type { DiagnosticsHistorySample } from "./DiagnosticsHistorySample";

/** Ordered demo samples shown in the comparison chart. */
export interface DiagnosticsHistoryChartProps {
  readonly samples: readonly DiagnosticsHistorySample[];
}
