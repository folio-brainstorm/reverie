import type {
  HistoryShortcutAction,
  HistoryShortcutInput,
} from "./interfaces/history/HistoryShortcut";

/**
 * Resolves cross-platform document Undo and Redo key combinations.
 *
 * @param input - Keyboard key and modifier state from a browser event.
 * @returns The requested action, or null when the combination is unsupported.
 */
export function resolveHistoryShortcut(
  input: HistoryShortcutInput,
): HistoryShortcutAction | null {
  if (input.altKey) {
    return null;
  }
  const key = input.key.toLowerCase();
  const hasPrimaryModifier = input.ctrlKey || input.metaKey;
  if (hasPrimaryModifier && key === "z") {
    return input.shiftKey ? "redo" : "undo";
  }
  if (input.ctrlKey && !input.metaKey && key === "y") {
    return "redo";
  }
  return null;
}
