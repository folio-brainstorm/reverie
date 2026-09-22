import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";
import type { RasterHistoryTransactionState } from "../../interfaces/history/RasterHistoryTransactionState.js";
import type { RasterTileSnapshot } from "../../interfaces/history/RasterTileSnapshot.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { withActiveRasterHistoryTransaction } from "../../internal/history/ActiveRasterHistoryTransaction.js";
import {
  acceptRasterHistoryTransaction,
  releaseRasterHistoryTransaction,
} from "../../internal/history/RasterHistoryTransactionBridge.js";
import { RasterTileHistoryEntry } from "../../internal/history/RasterTileHistoryEntry.js";
import {
  getAllocatedRasterTileSnapshots,
  getRasterTilePixels,
} from "../rendering/bridge/RasterRenderBridge.js";
import type { Raster } from "../raster/Raster.js";

/** Captures one asynchronous Raster edit as a single before/after history entry. */
export class RasterHistoryTransaction {
  /** Raster whose writes are captured by this transaction. */
  readonly raster: Raster;

  private currentState: RasterHistoryTransactionState = "open";
  private pendingMutationCount = 0;
  private readonly beforeSnapshotColumns = new Map<
    number,
    Map<number, RasterTileSnapshot>
  >();

  /**
   * Creates an owner-bound transaction. Callers obtain instances from
   * {@link DocumentHistory.beginRasterTransaction}.
   *
   * @param raster - Raster whose scoped writes should be captured.
   */
  constructor(raster: Raster) {
    this.raster = raster;
  }

  /** Returns whether cancellation prevents any further mutation execution. */
  get cancelled(): boolean {
    return this.currentState === "cancelled";
  }

  /** Reserves one scheduler command before it enters the asynchronous queue. */
  scheduleMutation(): void {
    this.assertState("schedule", ["open"]);
    this.pendingMutationCount += 1;
  }

  /**
   * Executes one scheduled mutation under Tile capture and completes its slot.
   * Cancelled transactions ignore queued work that had already been accepted.
   *
   * @param operation - Synchronous Raster mutation performed by one command.
   */
  executeMutation(operation: () => void): void {
    if (this.currentState === "cancelled") {
      return;
    }
    this.assertState("execute", ["open", "closing"]);
    if (this.pendingMutationCount <= 0) {
      throw ReverieError.from(
        ErrorDefinitions.HISTORY.INVALID_RASTER_TRANSACTION_STATE,
        { operation: "execute", state: this.currentState },
      );
    }
    try {
      withActiveRasterHistoryTransaction(this, operation);
    } catch (error) {
      try {
        this.cancel();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Raster mutation and transaction rollback both failed.",
        );
      }
      throw error;
    }
    this.pendingMutationCount -= 1;
    this.finalizeIfReady();
  }

  /** Closes input and commits after every previously scheduled command finishes. */
  close(): void {
    if (
      this.currentState === "cancelled" ||
      this.currentState === "committed"
    ) {
      return;
    }
    this.assertState("close", ["open"]);
    this.currentState = "closing";
    this.finalizeIfReady();
  }

  /** Rolls back executed writes and makes queued commands harmless no-ops. */
  cancel(): void {
    if (this.currentState === "cancelled") {
      return;
    }
    this.assertState("cancel", ["open", "closing"]);
    const before = this.getBeforeSnapshots();
    const after = before.map<RasterTileSnapshot>((snapshot) => ({
      coord: { ...snapshot.coord },
      pixels: getRasterTilePixels(this.raster, snapshot.coord) ?? null,
    }));
    try {
      if (before.length > 0) {
        new RasterTileHistoryEntry(this.raster, before, after).undo();
      }
    } finally {
      this.currentState = "cancelled";
      releaseRasterHistoryTransaction(this);
    }
  }

  /** Captures one Tile exactly once immediately before its first scoped write. */
  captureBeforeWrite(tileX: number, tileY: number): void {
    this.assertState("capture", ["open", "closing"]);
    const existingColumn = this.beforeSnapshotColumns.get(tileX);
    if (existingColumn?.has(tileY) === true) {
      return;
    }
    const column = existingColumn ?? new Map<number, RasterTileSnapshot>();
    if (existingColumn === undefined) {
      this.beforeSnapshotColumns.set(tileX, column);
    }
    column.set(tileY, {
      coord: { x: tileX, y: tileY },
      pixels: getRasterTilePixels(this.raster, { x: tileX, y: tileY }) ?? null,
    });
  }

  /** Captures every currently allocated Tile before a scoped clear operation. */
  captureBeforeClear(): void {
    this.assertState("capture", ["open", "closing"]);
    for (const snapshot of getAllocatedRasterTileSnapshots(this.raster)) {
      const existingColumn = this.beforeSnapshotColumns.get(snapshot.coord.x);
      if (existingColumn?.has(snapshot.coord.y) === true) {
        continue;
      }
      const column = existingColumn ?? new Map<number, RasterTileSnapshot>();
      if (existingColumn === undefined) {
        this.beforeSnapshotColumns.set(snapshot.coord.x, column);
      }
      column.set(snapshot.coord.y, snapshot);
    }
  }

  /** Commits a non-empty changed Tile set after input and work both finish. */
  private finalizeIfReady(): void {
    if (this.currentState !== "closing" || this.pendingMutationCount !== 0) {
      return;
    }
    const before: RasterTileSnapshot[] = [];
    const after: RasterTileSnapshot[] = [];
    for (const previous of this.getBeforeSnapshots()) {
      const next: RasterTileSnapshot = {
        coord: { ...previous.coord },
        pixels: getRasterTilePixels(this.raster, previous.coord) ?? null,
      };
      if (RasterHistoryTransaction.snapshotsEqual(previous, next)) {
        continue;
      }
      before.push(previous);
      after.push(next);
    }
    const entry: HistoryEntry | null =
      before.length === 0
        ? null
        : new RasterTileHistoryEntry(this.raster, before, after);
    this.currentState = "committed";
    acceptRasterHistoryTransaction(this, entry);
  }

  /** Flattens captured Tile columns only when commit or rollback needs them. */
  private getBeforeSnapshots(): RasterTileSnapshot[] {
    const snapshots: RasterTileSnapshot[] = [];
    for (const column of this.beforeSnapshotColumns.values()) {
      for (const snapshot of column.values()) {
        snapshots.push(snapshot);
      }
    }
    return snapshots;
  }

  /** Rejects lifecycle operations that cannot follow the current state. */
  private assertState(
    operation: string,
    allowedStates: readonly RasterHistoryTransactionState[],
  ): void {
    if (allowedStates.includes(this.currentState)) {
      return;
    }
    throw ReverieError.from(
      ErrorDefinitions.HISTORY.INVALID_RASTER_TRANSACTION_STATE,
      { operation, state: this.currentState },
    );
  }

  /** Compares Tile existence and every retained RGBA8 byte. */
  private static snapshotsEqual(
    left: RasterTileSnapshot,
    right: RasterTileSnapshot,
  ): boolean {
    if (left.pixels === null || right.pixels === null) {
      return left.pixels === right.pixels;
    }
    if (left.pixels.length !== right.pixels.length) {
      return false;
    }
    for (let index = 0; index < left.pixels.length; index += 1) {
      if (left.pixels[index] !== right.pixels[index]) {
        return false;
      }
    }
    return true;
  }
}
