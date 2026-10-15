/** Incremental measurements for one RenderingCore result cache. */
export interface RenderResultCacheDiagnostics {
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly entries: number;
  readonly bytes: number;
  readonly byteBudget: number;
  readonly insertions: number;
  readonly evictions: number;
  /** Lookups with retained variants but no exact match for the requested source signature. */
  readonly validationFailures: number;
  readonly reusedPixelBytes: number;
  /** Cumulative hits grouped by effective square output Tile edge length. */
  readonly hitsByOutputTileSize: Readonly<Record<string, number>>;
}
