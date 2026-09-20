import type { HistoryEntry } from "./HistoryEntry.js";

/** Internal callbacks that return a finalized Raster transaction to its owner. */
export interface RasterHistoryTransactionCallbacks {
  /** Accepts the completed transaction and its optional changed-Tile entry. */
  accept(entry: HistoryEntry | null): void;

  /** Releases a cancelled transaction after its captured state is restored. */
  release(): void;
}
