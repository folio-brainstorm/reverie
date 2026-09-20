import type { DocumentHistoryConfig } from "../../interfaces/history/DocumentHistoryConfig.js";
import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";
import type { WorldMutation } from "../../interfaces/world/WorldMutation.js";

import { CompositeHistoryEntry } from "../../internal/history/CompositeHistoryEntry.js";
import { registerRasterHistoryTransaction } from "../../internal/history/RasterHistoryTransactionBridge.js";
import { StateHistoryEntry } from "../../internal/history/StateHistoryEntry.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieRangeError,
} from "../../utils/errors/ReverieErrors.js";
import { getRasterAllocatedByteLength } from "../renderer/RasterRenderBridge.js";
import type { Raster } from "../raster/Raster.js";
import type { World } from "../world/World.js";
import { RasterHistoryTransaction } from "./RasterHistoryTransaction.js";

const DEFAULT_HISTORY_BYTE_BUDGET = 256 * 1024 * 1024;
const WORLD_ENTRY_BASE_BYTES = 128;

/** Owns bounded, operation-oriented undo and redo state for one editing session. */
export class DocumentHistory {
  private readonly world: World | undefined;
  private readonly stopObservingWorld: (() => void) | undefined;
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private groupEntries: HistoryEntry[] | null = null;
  private readonly rasterTransactions = new Set<RasterHistoryTransaction>();
  private retainedByteSize = 0;
  private byteBudget = DEFAULT_HISTORY_BYTE_BUDGET;
  private isApplying = false;

  /** Returns whether one committed edit can currently be undone. */
  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  /** Returns whether one previously undone edit can currently be redone. */
  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /**
   * Creates empty bounded history and optionally observes one World document.
   *
   * @param config - Optional World whose Layer mutations should be recorded.
   */
  constructor(config: DocumentHistoryConfig = {}) {
    this.world = config.world;
    this.stopObservingWorld = config.world?.observeMutations({
      beforeMutation: () => this.assertWorldMutationAllowed(),
      afterMutation: (mutation) => this.recordWorldMutation(mutation),
    });
  }

  /**
   * Starts one Raster edit whose scheduled commands may span multiple frames.
   *
   * @param raster - Raster whose scoped writes belong to the edit.
   * @returns A transaction that must be closed or cancelled by its owner.
   */
  beginRasterTransaction(raster: Raster): RasterHistoryTransaction {
    const transaction = new RasterHistoryTransaction(raster);
    this.rasterTransactions.add(transaction);
    registerRasterHistoryTransaction(transaction, {
      accept: (entry) => this.acceptRasterTransaction(transaction, entry),
      release: () => this.releaseRasterTransaction(transaction),
    });
    return transaction;
  }

  /**
   * Executes one synchronous Raster operation as one complete history step.
   *
   * @param raster - Raster receiving the operation.
   * @param operation - Synchronous mutation to capture and commit.
   */
  performRasterMutation(raster: Raster, operation: () => void): void {
    const transaction = this.beginRasterTransaction(raster);
    transaction.scheduleMutation();
    transaction.executeMutation(operation);
    transaction.close();
  }

  /** Begins a basic group that combines later mutations into one undo step. */
  beginGroup(): void {
    if (this.groupEntries !== null) {
      throw ReverieError.from(ErrorDefinitions.HISTORY.GROUP_ALREADY_ACTIVE);
    }
    this.assertNoActiveRasterTransactions();
    this.groupEntries = [];
  }

  /** Commits the current non-empty group as one bounded history entry. */
  commitGroup(): void {
    const entries = this.requireActiveGroup();
    this.assertNoActiveRasterTransactions();
    this.groupEntries = null;
    if (entries.length === 0) {
      return;
    }
    this.pushCommittedEntry(
      entries.length === 1 ? entries[0] : new CompositeHistoryEntry(entries),
    );
  }

  /** Cancels the current group and restores all changes it accumulated. */
  cancelGroup(): void {
    const entries = this.requireActiveGroup();
    this.assertNoActiveRasterTransactions();
    this.groupEntries = null;
    if (entries.length === 0) {
      return;
    }
    this.applyWithoutRecording(() => {
      new CompositeHistoryEntry(entries).undo();
    });
  }

  /** Restores the newest committed BEFORE state and transfers it to Redo. */
  undo(): void {
    this.assertCanApplyHistory("undo History");
    const entry = this.undoEntries.at(-1);
    if (entry === undefined) {
      return;
    }
    this.applyWithoutRecording(() => entry.undo());
    this.undoEntries.pop();
    this.redoEntries.push(entry);
  }

  /** Restores the newest committed AFTER state and transfers it to Undo. */
  redo(): void {
    this.assertCanApplyHistory("redo History");
    const entry = this.redoEntries.at(-1);
    if (entry === undefined) {
      return;
    }
    this.applyWithoutRecording(() => entry.redo());
    this.redoEntries.pop();
    this.undoEntries.push(entry);
  }

  /** Discards committed Undo and Redo entries without changing document state. */
  clear(): void {
    this.assertCanApplyHistory("clear History");
    this.undoEntries = [];
    this.redoEntries = [];
    this.retainedByteSize = 0;
  }

  /** Accepts one finalized Raster transaction without exposing stack mutation. */
  private acceptRasterTransaction(
    transaction: RasterHistoryTransaction,
    entry: HistoryEntry | null,
  ): void {
    this.rasterTransactions.delete(transaction);
    if (entry !== null) {
      this.recordEntry(entry);
    }
  }

  /** Releases a cancelled transaction without recording its restored state. */
  private releaseRasterTransaction(
    transaction: RasterHistoryTransaction,
  ): void {
    this.rasterTransactions.delete(transaction);
  }

  /** Stops observation, rolls back active Raster edits, and releases all entries. */
  dispose(): void {
    for (const transaction of [...this.rasterTransactions]) {
      transaction.cancel();
    }
    this.stopObservingWorld?.();
    this.groupEntries = null;
    this.undoEntries = [];
    this.redoEntries = [];
    this.retainedByteSize = 0;
  }

  // #if DEBUG
  /**
   * Overrides the byte budget for deterministic eviction tests.
   *
   * @param byteBudget - Positive safe-integer approximate memory budget.
   * @throws {ReverieRangeError} The budget is not a positive safe integer.
   */
  setByteBudgetForTesting(byteBudget: number): void {
    if (!Number.isSafeInteger(byteBudget) || byteBudget <= 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.HISTORY.INVALID_BYTE_BUDGET,
      );
    }
    this.byteBudget = byteBudget;
    this.evictOldestUndoEntries();
  }
  // #endif

  /** Rejects direct document changes while an asynchronous Raster edit is open. */
  private assertWorldMutationAllowed(): void {
    if (!this.isApplying && this.rasterTransactions.size > 0) {
      throw ReverieError.from(
        ErrorDefinitions.HISTORY.DOCUMENT_MUTATION_DURING_RASTER_EDIT,
      );
    }
  }

  /** Records one successful World mutation unless History is restoring it. */
  private recordWorldMutation(mutation: WorldMutation): void {
    if (this.isApplying) {
      return;
    }
    const world = this.world;
    if (world === undefined) {
      return;
    }
    this.recordEntry(DocumentHistory.createWorldEntry(world, mutation));
  }

  /** Adds an entry to the active group or commits it immediately. */
  private recordEntry(entry: HistoryEntry): void {
    if (this.groupEntries !== null) {
      this.groupEntries.push(entry);
      return;
    }
    this.pushCommittedEntry(entry);
  }

  /** Pushes a new edit, clears Redo, and evicts the oldest bounded history. */
  private pushCommittedEntry(entry: HistoryEntry | undefined): void {
    if (entry === undefined) {
      return;
    }
    for (const redoEntry of this.redoEntries) {
      this.retainedByteSize -= redoEntry.byteSize;
    }
    this.redoEntries = [];
    this.undoEntries.push(entry);
    this.retainedByteSize += entry.byteSize;
    this.evictOldestUndoEntries();
  }

  /** Evicts oldest Undo entries while always retaining the newest single edit. */
  private evictOldestUndoEntries(): void {
    while (
      this.retainedByteSize > this.byteBudget &&
      this.undoEntries.length > 1
    ) {
      const evicted = this.undoEntries.shift();
      if (evicted !== undefined) {
        this.retainedByteSize -= evicted.byteSize;
      }
    }
  }

  /** Runs restoration with World observers suppressed and stack movement deferred. */
  private applyWithoutRecording(operation: () => void): void {
    this.isApplying = true;
    try {
      operation();
    } finally {
      this.isApplying = false;
    }
  }

  /** Rejects stack operations until active grouping and Raster work finish. */
  private assertCanApplyHistory(operation: string): void {
    if (this.groupEntries !== null) {
      throw ReverieError.from(ErrorDefinitions.HISTORY.OPERATION_DURING_GROUP, {
        operation,
      });
    }
    this.assertNoActiveRasterTransactions();
  }

  /** Rejects operations that would reorder an unfinished Raster edit. */
  private assertNoActiveRasterTransactions(): void {
    if (this.rasterTransactions.size > 0) {
      throw ReverieError.from(
        ErrorDefinitions.HISTORY.DOCUMENT_MUTATION_DURING_RASTER_EDIT,
      );
    }
  }

  /** Returns the current group or reports the requested invalid transition. */
  private requireActiveGroup(): HistoryEntry[] {
    if (this.groupEntries === null) {
      throw ReverieError.from(ErrorDefinitions.HISTORY.GROUP_NOT_ACTIVE);
    }
    return this.groupEntries;
  }

  /** Converts one committed World mutation into deterministic state applicators. */
  private static createWorldEntry(
    world: World,
    mutation: WorldMutation,
  ): HistoryEntry {
    switch (mutation.kind) {
      case "layer-inserted":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES +
            getRasterAllocatedByteLength(mutation.layer.raster),
          () => world.removeLayer(mutation.layer),
          () => world.insertLayer(mutation.index, mutation.layer),
        );
      case "layer-removed":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES +
            getRasterAllocatedByteLength(mutation.layer.raster),
          () => world.insertLayer(mutation.index, mutation.layer),
          () => world.removeLayer(mutation.layer),
        );
      case "layer-moved":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES,
          () => world.moveLayer(mutation.layer, mutation.previousIndex),
          () => world.moveLayer(mutation.layer, mutation.index),
        );
      case "layer-name-changed":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES +
            (mutation.previousValue.length + mutation.value.length) * 2,
          () => {
            mutation.layer.name = mutation.previousValue;
          },
          () => {
            mutation.layer.name = mutation.value;
          },
        );
      case "layer-visibility-changed":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES,
          () => {
            mutation.layer.visible = mutation.previousValue;
          },
          () => {
            mutation.layer.visible = mutation.value;
          },
        );
      case "layer-opacity-changed":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES,
          () => {
            mutation.layer.opacity = mutation.previousValue;
          },
          () => {
            mutation.layer.opacity = mutation.value;
          },
        );
      case "layer-blend-mode-changed":
        return new StateHistoryEntry(
          WORLD_ENTRY_BASE_BYTES,
          () => {
            mutation.layer.blendMode = mutation.previousValue;
          },
          () => {
            mutation.layer.blendMode = mutation.value;
          },
        );
    }
  }
}
