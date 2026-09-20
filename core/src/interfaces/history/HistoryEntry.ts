/** One reversible document mutation retained by the bounded history stacks. */
export interface HistoryEntry {
  /** Conservative approximate memory retained by this entry, in bytes. */
  readonly byteSize: number;

  /** Restores document state from after this mutation to before it. */
  undo(): void;

  /** Restores document state from before this mutation to after it. */
  redo(): void;
}
