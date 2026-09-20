/** One renderer-derived LOD surface retained by the byte-budgeted cache. */
export interface CanvasLodCacheEntry {
  /** Canvas containing the filtered tile pixels for one LOD level. */
  readonly canvas: HTMLCanvasElement;

  /** Context that receives regenerated pixels when source state changes. */
  readonly context: CanvasRenderingContext2D;

  /** Approximate persistent RGBA backing-store cost used by LRU accounting. */
  readonly byteCost: number;

  /** Center and eight-neighbor source state represented by this surface. */
  signature: string;
}
