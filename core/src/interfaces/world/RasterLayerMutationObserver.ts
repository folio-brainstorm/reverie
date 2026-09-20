import type { RasterLayerMutation } from "./RasterLayerMutation.js";

/** Observes validated RasterLayer property changes around their commit point. */
export interface RasterLayerMutationObserver {
  /** May reject a proposed property mutation before the value changes. */
  readonly beforeMutation?: (mutation: RasterLayerMutation) => void;

  /** Receives a property mutation immediately after the value changes. */
  readonly afterMutation?: (mutation: RasterLayerMutation) => void;
}
