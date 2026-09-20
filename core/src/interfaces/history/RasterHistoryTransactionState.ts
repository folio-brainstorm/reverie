/** Lifecycle state of one asynchronous Raster history transaction. */
export type RasterHistoryTransactionState =
  "open" | "closing" | "committed" | "cancelled";
