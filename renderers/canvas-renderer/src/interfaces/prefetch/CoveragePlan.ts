/** Bounded screen-space coverage selected for one camera position. */
export interface CoveragePlan {
  readonly renderMarginTiles: number;
  readonly retainMarginTiles: number;
  readonly lookaheadTiles: number;
  readonly velocityPixelsPerMs: number;
  readonly directionX: -1 | 0 | 1;
  readonly directionY: -1 | 0 | 1;
}
