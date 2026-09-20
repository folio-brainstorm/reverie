import type { WorldMutation } from "./WorldMutation.js";

/** Observes validated World changes before and after they commit. */
export interface WorldMutationObserver {
  /** May reject a proposed mutation before document state changes. */
  readonly beforeMutation?: (mutation: WorldMutation) => void;

  /** Receives a mutation immediately after document state changes. */
  readonly afterMutation?: (mutation: WorldMutation) => void;
}
