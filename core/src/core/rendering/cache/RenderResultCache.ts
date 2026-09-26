import type { RenderRegion } from "../../../interfaces/renderer/RenderRegion.js";
import type { RenderResultCacheEntry } from "../../../interfaces/renderer/RenderResultCacheEntry.js";
import type { RenderResultCacheDiagnostics } from "../../../interfaces/renderer/RenderResultCacheDiagnostics.js";

/** Bounded least-recently-used storage for published full-Region results. */
export default class RenderResultCache {
  private readonly entries = new Map<string, RenderResultCacheEntry>();
  private retainedBytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private insertionCount = 0;
  private evictionCount = 0;
  private validationFailureCount = 0;
  private reusedPixelBytes = 0;
  private readonly hitsByOutputTileSize = new Map<number, number>();

  /** Creates storage with a fixed nonnegative final-pixel byte limit. */
  constructor(readonly byteBudget: number) {}

  /** Returns the exact published result and refreshes its eviction priority. */
  get(
    key: string,
    signature: string,
    outputTileSize: number,
  ): RenderRegion | undefined {
    return this.getCompatible([key], signature, outputTileSize);
  }

  /**
   * Looks up compatible variants in priority order while counting one request.
   * @param keys - Cache keys ordered from most to least preferred pixels.
   * @param signature - Current source and layer state required for reuse.
   * @param outputTileSize - Square output edge used for cache diagnostics.
   * @returns The retained Region, or undefined if every variant misses.
   */
  getCompatible(
    keys: readonly string[],
    signature: string,
    outputTileSize: number,
  ): RenderRegion | undefined {
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry === undefined) {
        continue;
      }
      if (entry.signature !== signature) {
        this.validationFailureCount += 1;
        this.retainedBytes -= entry.region.pixels.byteLength;
        this.entries.delete(key);
        continue;
      }
      this.entries.delete(key);
      this.entries.set(key, entry);
      this.hitCount += 1;
      this.reusedPixelBytes += entry.region.pixels.byteLength;
      this.hitsByOutputTileSize.set(
        outputTileSize,
        (this.hitsByOutputTileSize.get(outputTileSize) ?? 0) + 1,
      );
      return entry.region;
    }
    this.missCount += 1;
    return undefined;
  }

  /** Retains one independent output variant when it fits the byte budget. */
  set(key: string, signature: string, region: RenderRegion): void {
    const bytes = region.pixels.byteLength;
    if (this.byteBudget === 0 || bytes > this.byteBudget) {
      return;
    }
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.retainedBytes -= previous.region.pixels.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, { signature, region });
    this.retainedBytes += bytes;
    this.insertionCount += 1;
    while (this.retainedBytes > this.byteBudget) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.retainedBytes -= oldest?.region.pixels.byteLength ?? 0;
      this.evictionCount += 1;
    }
  }

  /** Drops all retained buffers and resets cache accounting immediately. */
  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.insertionCount = 0;
    this.evictionCount = 0;
    this.validationFailureCount = 0;
    this.reusedPixelBytes = 0;
    this.hitsByOutputTileSize.clear();
  }

  /** Returns cheap counters without scanning retained entries. */
  getSnapshot(): RenderResultCacheDiagnostics {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate:
        this.hitCount + this.missCount === 0
          ? 0
          : this.hitCount / (this.hitCount + this.missCount),
      entries: this.entries.size,
      bytes: this.retainedBytes,
      byteBudget: this.byteBudget,
      insertions: this.insertionCount,
      evictions: this.evictionCount,
      validationFailures: this.validationFailureCount,
      reusedPixelBytes: this.reusedPixelBytes,
      hitsByOutputTileSize: Object.fromEntries(this.hitsByOutputTileSize),
    };
  }
}
