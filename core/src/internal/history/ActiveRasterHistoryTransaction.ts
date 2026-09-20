import type { Raster } from "../../core/raster/Raster.js";
import type { RasterHistoryTransaction } from "../../core/history/RasterHistoryTransaction.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";

const ACTIVE_TRANSACTIONS = new WeakMap<Raster, RasterHistoryTransaction>();

/** Runs one synchronous Raster mutation inside its retained transaction scope. */
export function withActiveRasterHistoryTransaction<T>(
  transaction: RasterHistoryTransaction,
  operation: () => T,
): T {
  const raster = transaction.raster;
  const existing = ACTIVE_TRANSACTIONS.get(raster);
  if (existing !== undefined) {
    throw ReverieError.from(ErrorDefinitions.HISTORY.NESTED_RASTER_MUTATION);
  }
  ACTIVE_TRANSACTIONS.set(raster, transaction);
  try {
    return operation();
  } finally {
    ACTIVE_TRANSACTIONS.delete(raster);
  }
}

/** Captures one Tile before a trusted write when history is currently active. */
export function captureRasterTileBeforeWrite(
  raster: Raster,
  tileX: number,
  tileY: number,
): void {
  ACTIVE_TRANSACTIONS.get(raster)?.captureBeforeWrite(tileX, tileY);
}

/** Captures every allocated Tile before a transaction-scoped Raster clear. */
export function captureAllocatedRasterTilesBeforeClear(raster: Raster): void {
  ACTIVE_TRANSACTIONS.get(raster)?.captureBeforeClear();
}
