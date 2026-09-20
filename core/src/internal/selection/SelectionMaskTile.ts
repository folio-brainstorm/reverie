/** Stores one compact byte-coverage tile and tracks whether it remains sparse. */
export class SelectionMaskTile {
  private readonly coverage: Uint8Array;
  private nonZeroCoverageCount = 0;

  /** Returns whether every coverage byte in this tile is zero. */
  get empty(): boolean {
    return this.nonZeroCoverageCount === 0;
  }

  /** Creates an empty square coverage tile. */
  constructor(private readonly tileSize: number) {
    this.coverage = new Uint8Array(tileSize * tileSize);
  }

  /** Returns one byte without allocating an intermediate coordinate object. */
  get(localX: number, localY: number): number {
    return this.coverage[localY * this.tileSize + localX] ?? 0;
  }

  /** Replaces one byte and updates the tile's non-zero occupancy count. */
  set(localX: number, localY: number, value: number): void {
    const offset = localY * this.tileSize + localX;
    const previous = this.coverage[offset] ?? 0;

    if (previous === value) {
      return;
    }
    if (previous === 0) {
      this.nonZeroCoverageCount += 1;
    } else if (value === 0) {
      this.nonZeroCoverageCount -= 1;
    }
    this.coverage[offset] = value;
  }

  /** Fills a half-open local rectangle with opaque coverage. */
  fillOpaque(
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
  ): void {
    for (let localY = minimumY; localY < maximumY; localY += 1) {
      const rowOffset = localY * this.tileSize;
      for (let localX = minimumX; localX < maximumX; localX += 1) {
        const offset = rowOffset + localX;
        if (this.coverage[offset] === 0) {
          this.coverage[offset] = 255;
          this.nonZeroCoverageCount += 1;
        }
      }
    }
  }
}
