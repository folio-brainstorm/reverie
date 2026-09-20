/** Document History action selected by one supported keyboard shortcut. */
export type HistoryShortcutAction = "undo" | "redo";

/** Modifier and key facts required to resolve a History shortcut. */
export interface HistoryShortcutInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}
