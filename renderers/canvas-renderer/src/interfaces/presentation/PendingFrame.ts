import type { RenderRequestIdentity } from "@reverie/core/renderer";

/** Mutable accumulation state for a single unfinished render request. */
export interface PendingFrame {
  /** Identity required for every batch merged into this frame. */
  readonly identity: RenderRequestIdentity;
}
