import type { RasterLayer } from "@reveriejs/core";

import type { HistoryGroupKind } from "./HistoryGroupKind";

/** One Demo interaction currently grouping mutations for a specific Layer. */
export interface ActiveHistoryGroup {
  readonly kind: HistoryGroupKind;
  readonly layer: RasterLayer;
}
