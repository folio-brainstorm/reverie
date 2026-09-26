/**
 * Limits the synchronous work produced by one RenderingCore batch.
 *
 * Each limit is evaluated in traversal, pixel-output, then duration order.
 * All values are positive so every nonempty request can make forward progress.
 */
export interface RenderBudget {
  /** Maximum allocated tile candidates inspected by one batch. */
  readonly maxCandidateTiles: number;

  /** Maximum RGBA8 bytes returned by one batch, including cache hits. */
  readonly maxGeneratedPixelBytes: number;

  /** Soft maximum synchronous duration, in milliseconds, for one batch. */
  readonly maxRenderDurationMs: number;
}
