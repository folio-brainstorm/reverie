import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";

/** Retains two deterministic state applicators as one internal history entry. */
export class StateHistoryEntry implements HistoryEntry {
  /** Conservative approximate memory retained by this entry, in bytes. */
  readonly byteSize: number;

  /** Creates an entry from already validated restoration operations. */
  constructor(
    byteSize: number,
    private readonly applyBefore: () => void,
    private readonly applyAfter: () => void,
  ) {
    this.byteSize = byteSize;
  }

  /** Applies the retained state from before the mutation. */
  undo(): void {
    this.applyBefore();
  }

  /** Applies the retained state from after the mutation. */
  redo(): void {
    this.applyAfter();
  }
}
