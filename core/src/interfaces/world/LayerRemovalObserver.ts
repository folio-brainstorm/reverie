import type { RasterLayer } from "../../core/world/RasterLayer.js";

/** Hooks for external consumers that retain references to document layers. */
export interface LayerRemovalObserver {
  /** May throw to reject removal before document state changes. */
  beforeRemove?(layer: RasterLayer): void;
  /** Receives the removed layer and its former bottom-to-top index. */
  afterRemove?(layer: RasterLayer, index: number): void;
  /** Must not throw; releases reservations after success or rejected validation. */
  afterRemovalAttempt?(): void;
}
