import type { SelectionCoverageVisitor } from "../../interfaces/selection/SelectionCoverageVisitor.js";
import type { SelectionCoverageCombiner } from "../../interfaces/selection/SelectionCoverageCombiner.js";
import type { SelectionSpanVisitor } from "../../interfaces/selection/SelectionSpanVisitor.js";

/** Stores one compact byte-coverage tile and tracks whether it remains sparse. */
export class SelectionMaskTile {
  private readonly coverage: Uint8Array;
  private nonZeroCoverageCount = 0;
  private opaqueCoverageCount = 0;

  /** Whether every pixel is fully covered, permitting constant-time composition. */
  get opaque(): boolean {
    return this.opaqueCoverageCount === this.coverage.length;
  }

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
    if (previous === 255) this.opaqueCoverageCount -= 1;
    if (value === 255) this.opaqueCoverageCount += 1;
    this.coverage[offset] = value;
  }

  /**
   * Copies byte storage and occupancy metadata without per-pixel coordinate work.
   * @returns An independently mutable tile with identical coverage.
   */
  clone(): SelectionMaskTile {
    const tile = new SelectionMaskTile(this.tileSize);
    tile.coverage.set(this.coverage);
    tile.nonZeroCoverageCount = this.nonZeroCoverageCount;
    tile.opaqueCoverageCount = this.opaqueCoverageCount;
    return tile;
  }

  /**
   * Combines matching tile grids in place and rebuilds occupancy counters.
   * @param other - Source tile of the same size. Distinct sources stay unchanged;
   * self-composition reads each byte's coverage before overwriting that byte.
   * @param combine - Pure operation returning an integer coverage byte.
   */
  combineInPlace(
    other: SelectionMaskTile,
    combine: SelectionCoverageCombiner,
  ): void {
    let nonZeroCount = 0;
    let opaqueCount = 0;
    for (let offset = 0; offset < this.coverage.length; offset += 1) {
      const value = combine(
        this.coverage[offset] ?? 0,
        other.coverage[offset] ?? 0,
      );
      this.coverage[offset] = value;
      if (value !== 0) nonZeroCount += 1;
      if (value === 255) opaqueCount += 1;
    }
    this.nonZeroCoverageCount = nonZeroCount;
    this.opaqueCoverageCount = opaqueCount;
  }

  /**
   * Visits nonzero runs; fully occupied tiles emit rows without inspecting bytes.
   * @param visit - Receives half-open local spans. Must not mutate this tile.
   */
  forEachSelectedSpan(visit: SelectionSpanVisitor): void {
    if (this.nonZeroCoverageCount === this.coverage.length) {
      for (let y = 0; y < this.tileSize; y += 1) visit(0, this.tileSize, y);
      return;
    }
    for (let y = 0; y < this.tileSize; y += 1) {
      let start: number | undefined;
      for (let x = 0; x <= this.tileSize; x += 1) {
        const isSelected =
          x < this.tileSize &&
          (this.coverage[y * this.tileSize + x] ?? 0) !== 0;
        if (isSelected && start === undefined) start = x;
        if (!isSelected && start !== undefined) {
          visit(start, x, y);
          start = undefined;
        }
      }
    }
  }

  /**
   * Visits nonzero bytes without exposing the mutable coverage buffer.
   *
   * @param visit - Receives local pixel coordinates and byte coverage. May update
   * the visited pixel; must not add coverage at other pixels during traversal.
   */
  forEachCoveredPixel(visit: SelectionCoverageVisitor): void {
    for (let offset = 0; offset < this.coverage.length; offset += 1) {
      const coverageByte = this.coverage[offset] ?? 0;
      if (coverageByte !== 0) {
        visit(
          offset % this.tileSize,
          Math.floor(offset / this.tileSize),
          coverageByte,
        );
      }
    }
  }

  /** Fills a half-open local rectangle with opaque coverage. */
  fillOpaque(
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
  ): void {
    if (this.opaque) return;
    for (let localY = minimumY; localY < maximumY; localY += 1) {
      const rowOffset = localY * this.tileSize;
      for (let localX = minimumX; localX < maximumX; localX += 1) {
        const offset = rowOffset + localX;
        const previous = this.coverage[offset] ?? 0;
        if (previous !== 255) {
          this.coverage[offset] = 255;
          this.opaqueCoverageCount += 1;
          if (previous === 0) this.nonZeroCoverageCount += 1;
        }
      }
    }
  }
}
