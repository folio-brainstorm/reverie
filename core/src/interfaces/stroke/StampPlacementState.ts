/**
 * Carries streaming placement progress between adjacent processed path segments.
 */
export interface StampPlacementState {
  /** World-space path distance accumulated after the most recently emitted stamp. */
  readonly distanceSinceLastStamp: number;

  /** Positive interval from the most recently emitted stamp to its successor. */
  readonly nextStampDistance: number;
}
