import type { TimingMetric } from "./TimingMetric.js";
import type { RenderResultCacheDiagnostics } from "./RenderResultCacheDiagnostics.js";

/** Measurements owned by one platform-independent rendering core. */
export interface RenderingCoreDiagnosticsSnapshot {
  readonly resultCache: RenderResultCacheDiagnostics;
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
    /** Newly generated final output bytes in the latest batch. */
    readonly generatedPixelBytes: number;
    /** Bytes of output returned in the latest batch, including cache hits. */
    readonly outputPixelBytes: number;
  };
  readonly regions: {
    readonly generatedCount: number;
  };
  /** Cumulative World work, excluding Raster and presentation. */
  readonly world: {
    readonly canonicalGeneratedCount: number;
    readonly approximateGeneratedCount: number;
    readonly canonicalCacheHits: number;
    readonly approximateCacheHits: number;
    /** Number of contributor pixels passed through the blend operation. */
    readonly canonicalCompositionPixels: number;
    readonly approximateCompositionPixels: number;
    /** Includes contributor lookup, sampling or downsampling, and composition. */
    readonly canonicalGenerationDurationMs: number;
    readonly approximateGenerationDurationMs: number;
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
