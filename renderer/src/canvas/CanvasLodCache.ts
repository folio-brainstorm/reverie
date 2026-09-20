import type { CanvasLodCacheEntry } from "../interfaces/canvas/CanvasLodCacheEntry.js";

/**
 * Retains renderer-derived LOD surfaces using byte-accounted LRU eviction.
 *
 * Cache hits refresh recency. An entry larger than the total budget remains
 * usable by its caller for the current frame but is immediately evicted.
 */
export default class CanvasLodCache {
  private readonly entries = new Map<string, CanvasLodCacheEntry>();
  private currentByteCost = 0;

  /**
   * Creates an empty cache with a fixed logical byte budget.
   *
   * @param byteBudget - Maximum retained approximate RGBA backing-store bytes.
   */
  constructor(private readonly byteBudget: number) {}

  /**
   * Returns and refreshes the cached entry for a derived Tile representation.
   *
   * @param key - Stable coordinate and LOD identifier.
   * @returns The retained entry, or `undefined` when it is absent.
   */
  get(key: string): CanvasLodCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Inserts or replaces one entry and evicts least-recently-used surfaces.
   *
   * @param key - Stable coordinate and LOD identifier.
   * @param entry - Derived surface and its approximate persistent byte cost.
   */
  set(key: string, entry: CanvasLodCacheEntry): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.currentByteCost -= previous.byteCost;
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
    this.currentByteCost += entry.byteCost;

    while (this.currentByteCost > this.byteBudget) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.delete(oldestKey);
    }
  }

  /**
   * Removes one retained surface when its source coordinate becomes empty.
   *
   * @param key - Stable coordinate and LOD identifier.
   */
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return;
    }

    this.currentByteCost -= entry.byteCost;
    this.entries.delete(key);
  }
}
