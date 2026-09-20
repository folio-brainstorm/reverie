import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";

/** Applies a committed group of entries as one atomic history step. */
export class CompositeHistoryEntry implements HistoryEntry {
  /** Conservative sum of every retained child entry. */
  readonly byteSize: number;

  /** Creates one immutable group in original mutation order. */
  constructor(private readonly entries: readonly HistoryEntry[]) {
    this.byteSize = entries.reduce((total, entry) => total + entry.byteSize, 0);
  }

  /** Undoes children in reverse order and compensates if one fails. */
  undo(): void {
    const applied: HistoryEntry[] = [];
    try {
      for (let index = this.entries.length - 1; index >= 0; index -= 1) {
        const entry = this.entries[index];
        if (entry === undefined) {
          continue;
        }
        entry.undo();
        applied.push(entry);
      }
    } catch (error) {
      try {
        for (let index = applied.length - 1; index >= 0; index -= 1) {
          applied[index]?.redo();
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "History group undo and compensation both failed.",
        );
      }
      throw error;
    }
  }

  /** Redoes children in original order and compensates if one fails. */
  redo(): void {
    const applied: HistoryEntry[] = [];
    try {
      for (const entry of this.entries) {
        entry.redo();
        applied.push(entry);
      }
    } catch (error) {
      try {
        for (let index = applied.length - 1; index >= 0; index -= 1) {
          applied[index]?.undo();
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "History group redo and compensation both failed.",
        );
      }
      throw error;
    }
  }
}
