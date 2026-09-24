import type { TimingMetric } from "./TimingMetric.js";

/** Measurements owned by one platform-independent rendering core. */
export interface RenderingCoreDiagnosticsSnapshot {
  readonly rendering?: {
    /** Duration of the latest resolved batch, including traversal and pixels. */
    readonly coreDurationMs: TimingMetric;
    /** Time spent resolving Raster Tile pixels, including LOD work. */
    readonly rasterDurationMs: TimingMetric;
    /** Time spent composing World Tiles, including LOD work. */
    readonly compositionDurationMs: TimingMetric;
    /** Time spent producing lower-resolution Tile output. */
    readonly lodDurationMs: TimingMetric;
  };
  readonly tiles: {
    readonly candidateCount: number;
    readonly visibleCount: number;
    readonly renderedCount: number;
    readonly renderEmptyCount: number;
    readonly generatedPixelBytes: number;
  };
  readonly regions: {
    readonly generatedCount: number;
  };
  readonly progressive: {
    readonly requestCount: number;
    readonly completedRequestCount: number;
    readonly cancelledRequestCount: number;
    readonly continuationCount: number;
    readonly batchCount: number;
    readonly hasPendingRequest: boolean;
  };
  readonly quality?: {
    readonly outputTileSize: number;
    readonly effectiveRenderScale: number;
  };
}
