import type { RasterHistoryTransactionCallbacks } from "../../interfaces/history/RasterHistoryTransactionCallbacks.js";
import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import type { RasterHistoryTransaction } from "../../core/history/RasterHistoryTransaction.js";

const TRANSACTION_CALLBACKS = new WeakMap<
  RasterHistoryTransaction,
  RasterHistoryTransactionCallbacks
>();

/** Connects an internally created transaction to its owning History controller. */
export function registerRasterHistoryTransaction(
  transaction: RasterHistoryTransaction,
  callbacks: RasterHistoryTransactionCallbacks,
): void {
  TRANSACTION_CALLBACKS.set(transaction, callbacks);
}

/** Delivers a completed transaction entry exactly once to its owner. */
export function acceptRasterHistoryTransaction(
  transaction: RasterHistoryTransaction,
  entry: HistoryEntry | null,
): void {
  const callbacks = requireCallbacks(transaction, "commit");
  TRANSACTION_CALLBACKS.delete(transaction);
  callbacks.accept(entry);
}

/** Releases a cancelled transaction exactly once from its owner. */
export function releaseRasterHistoryTransaction(
  transaction: RasterHistoryTransaction,
): void {
  const callbacks = requireCallbacks(transaction, "cancel");
  TRANSACTION_CALLBACKS.delete(transaction);
  callbacks.release();
}

/** Returns registered callbacks or reports unsupported direct construction. */
function requireCallbacks(
  transaction: RasterHistoryTransaction,
  operation: string,
): RasterHistoryTransactionCallbacks {
  const callbacks = TRANSACTION_CALLBACKS.get(transaction);
  if (callbacks === undefined) {
    throw ReverieError.from(
      ErrorDefinitions.HISTORY.INVALID_RASTER_TRANSACTION_STATE,
      { operation, state: "unregistered" },
    );
  }
  return callbacks;
}
