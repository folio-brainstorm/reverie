import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { Rect } from "../../interfaces/pixel/Rect.js";
import type { SelectionMaskConfig } from "../../interfaces/selection/SelectionMaskConfig.js";
import type { SelectionCoverageVisitor } from "../../interfaces/selection/SelectionCoverageVisitor.js";
import type { SelectionSpanVisitor } from "../../interfaces/selection/SelectionSpanVisitor.js";

import { SelectionMaskTile } from "../../internal/selection/SelectionMaskTile.js";
import { rasterizePolygonSpans } from "../../internal/selection/RasterizePolygonSpans.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";

const DEFAULT_SELECTION_TILE_SIZE = 256;
const MAX_COVERAGE_BYTE = 255;

/**
 * Stores normalized world-pixel coverage in sparse, one-channel tiles.
 *
 * Mutating methods must not be used on a mask installed in a web session until
 * its active stroke and queued drawing work have finished.
 */
export class SelectionMask {
  /** Number of coverage pixels along each immutable tile edge. */
  readonly tileSize: number;

  /** Tile columns keyed first by X and then by Y without per-read key allocation. */
  private readonly tileColumns = new Map<
    number,
    Map<number, SelectionMaskTile>
  >();

  // #if DEBUG
  /** Number of currently allocated non-empty coverage tiles. */
  get allocatedTileCount(): number {
    let count = 0;
    for (const column of this.tileColumns.values()) {
      count += column.size;
    }
    return count;
  }
  // #endif

  /**
   * Creates an empty selection whose missing tiles have zero coverage.
   *
   * @param config - Optional internal tile-size override.
   * @throws {ReverieRangeError} The tile size is not a positive safe integer.
   */
  constructor(config: SelectionMaskConfig = {}) {
    const tileSize = config.tileSize ?? DEFAULT_SELECTION_TILE_SIZE;
    if (!isValidTileSize(tileSize)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
        tileSize,
      });
    }
    this.tileSize = tileSize;
  }

  /**
   * Creates an opaque hard-edged selection over a half-open pixel rectangle.
   *
   * @param rect - Safe-integer origin and positive safe-integer dimensions.
   * @param config - Optional internal tile-size override.
   * @returns A new mask with coverage one inside the rectangle and zero outside.
   * @throws {ReverieRangeError} The rectangle is malformed, overflows safe
   * integer bounds, or has an unsafe pixel count.
   */
  static fromRect(rect: Rect, config: SelectionMaskConfig = {}): SelectionMask {
    SelectionMask.assertValidRect(rect);
    const selection = new SelectionMask(config);
    selection.fillOpaqueRect(rect);
    return selection;
  }

  /**
   * Creates a hard-edged selection from an implicitly closed world-space path.
   *
   * Uses even-odd filling at pixel centers, including lower/left endpoints and
   * excluding upper/right endpoints. Concave and self-crossing paths, fractional
   * vertices, and repeated points are supported. Uncovered paths return an empty
   * mask; geometry is not retained after rasterization.
   *
   * @param points - At least three vertices with finite numeric world coordinates.
   * @param config - Optional internal tile-size override.
   * @returns A new sparse mask with coverage zero or one at each world pixel.
   * @throws {ReverieRangeError} The path is malformed, its candidate pixel bounds
   * or pixel count are unsafe, or the tile size is invalid.
   * @example
   * const mask = SelectionMask.fromPolygon([
   *   { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 },
   * ]);
   * mask.getCoverage(0, 0); // 1
   * mask.getCoverage(3, 0); // 0: the center is on the excluded right edge.
   */
  static fromPolygon(
    points: readonly WorldPoint[],
    config: SelectionMaskConfig = {},
  ): SelectionMask {
    const selection = new SelectionMask(config);
    rasterizePolygonSpans(points, (minimumX, maximumX, y) => {
      selection.fillOpaqueSpan(minimumX, maximumX, y);
    });
    return selection;
  }

  /**
   * Reads normalized coverage without allocating a missing tile.
   *
   * @param x - Safe-integer world-pixel X coordinate.
   * @param y - Safe-integer world-pixel Y coordinate.
   * @returns Stored byte coverage normalized to the inclusive `0..1` range.
   * @throws {ReverieTypeError} A coordinate is not a number.
   * @throws {ReverieRangeError} A coordinate is not a safe integer.
   */
  getCoverage(x: number, y: number): number {
    this.assertValidCoordinate(x, y);
    return this.getCoverageByte(x, y) / MAX_COVERAGE_BYTE;
  }

  /**
   * Quantizes and stores normalized coverage at one world pixel.
   *
   * Zero coverage never allocates an absent tile. Clearing the final covered
   * pixel in a tile releases that tile.
   *
   * @param x - Safe-integer world-pixel X coordinate.
   * @param y - Safe-integer world-pixel Y coordinate.
   * @param coverage - Finite normalized coverage in the inclusive `0..1` range.
   * @throws {ReverieTypeError} A coordinate is not a number.
   * @throws {ReverieRangeError} A coordinate is unsafe or coverage is invalid.
   */
  setCoverage(x: number, y: number, coverage: number): void {
    this.assertValidCoordinate(x, y);
    if (!isUnitInterval(coverage)) {
      throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_COVERAGE);
    }

    const coverageByte = Math.round(coverage * MAX_COVERAGE_BYTE);
    this.setCoverageByte(x, y, coverageByte);
  }

  /** Clears all stored coverage while retaining an active empty Selection. */
  clear(): void {
    this.tileColumns.clear();
  }

  /**
   * Visits horizontal spans containing nonzero coverage without allocating pixels.
   *
   * Runs are split at tile boundaries; traversal order is unspecified. Fully
   * occupied tiles are visited by row without scanning their individual bytes.
   *
   * @param visit - Receives minimum X (inclusive), maximum X (exclusive), and Y.
   * Must not mutate this mask during traversal. Fractional coverage is included.
   * @throws {ReverieTypeError} The visitor is not a function.
   * @example
   * mask.forEachSelectedSpan((minimumX, maximumX, y) => {
   *   // Every integer X in [minimumX, maximumX) has nonzero coverage at Y.
   * });
   */
  forEachSelectedSpan(visit: SelectionSpanVisitor): void {
    if (typeof visit !== "function") {
      throw ReverieTypeError.from(
        ErrorDefinitions.SELECTION.INVALID_SPAN_VISITOR,
      );
    }
    for (const [tileX, column] of this.tileColumns) {
      for (const [tileY, tile] of column) {
        const originX = tileX * this.tileSize;
        const originY = tileY * this.tileSize;
        tile.forEachSelectedSpan((minimumX, maximumX, localY) => {
          visit(originX + minimumX, originX + maximumX, originY + localY);
        });
      }
    }
  }

  /**
   * Replaces all coverage with an independent copy of another selection.
   *
   * @param other - Source mask, including masks with different tile sizes.
   * The source stays unchanged; replacing with this mask is a no-op.
   * @throws {ReverieTypeError} The source is not a SelectionMask instance.
   */
  replace(other: SelectionMask): void {
    SelectionMask.assertValidMask(other);
    if (other === this) {
      return;
    }
    this.clear();
    if (other.tileSize === this.tileSize) {
      for (const [tileX, column] of other.tileColumns) {
        const copiedColumn = new Map<number, SelectionMaskTile>();
        for (const [tileY, tile] of column)
          copiedColumn.set(tileY, tile.clone());
        this.tileColumns.set(tileX, copiedColumn);
      }
      return;
    }
    other.forEachCoveredPixel((x, y, coverageByte) => {
      this.setCoverageByte(x, y, coverageByte);
    });
  }

  /**
   * Adds another region by retaining the maximum coverage at each world pixel.
   *
   * @param other - Source mask, including masks with different tile sizes.
   * The source stays unchanged; adding this mask to itself is a no-op.
   * @throws {ReverieTypeError} The source is not a SelectionMask instance.
   */
  add(other: SelectionMask): void {
    SelectionMask.assertValidMask(other);
    if (other === this) {
      return;
    }
    if (other.tileSize === this.tileSize) {
      this.addTiles(other);
      return;
    }
    other.forEachCoveredPixel((x, y, coverageByte) => {
      this.setCoverageByte(
        x,
        y,
        Math.max(this.getCoverageByte(x, y), coverageByte),
      );
    });
  }

  /**
   * Removes coverage proportionally to another selection's coverage.
   *
   * For bytes A and B, stores `Math.round(A * (255 - B) / 255)`. Self-subtraction
   * follows this rule too: opaque pixels clear, while fractional pixels can remain.
   *
   * @param other - Source mask, including masks with different tile sizes.
   * Distinct source masks stay unchanged; the receiver retains its tile size.
   * @throws {ReverieTypeError} The source is not a SelectionMask instance.
   */
  subtract(other: SelectionMask): void {
    SelectionMask.assertValidMask(other);
    if (other.tileSize === this.tileSize) {
      this.subtractTiles(other);
      return;
    }
    this.forEachCoveredPixel((x, y, coverageByte) => {
      const remainingByte = Math.round(
        (coverageByte * (MAX_COVERAGE_BYTE - other.getCoverageByte(x, y))) /
          MAX_COVERAGE_BYTE,
      );
      this.setCoverageByte(x, y, remainingByte);
    });
  }

  /**
   * Keeps shared coverage by retaining the minimum coverage at each world pixel.
   *
   * @param other - Source mask, including masks with different tile sizes.
   * The source stays unchanged; intersecting with this mask is a no-op.
   * @throws {ReverieTypeError} The source is not a SelectionMask instance.
   */
  intersect(other: SelectionMask): void {
    SelectionMask.assertValidMask(other);
    if (other === this) {
      return;
    }
    if (other.tileSize === this.tileSize) {
      this.intersectTiles(other);
      return;
    }
    this.forEachCoveredPixel((x, y, coverageByte) => {
      this.setCoverageByte(
        x,
        y,
        Math.min(coverageByte, other.getCoverageByte(x, y)),
      );
    });
  }

  /** Reuses aligned source tiles and skips opaque destination tiles. */
  private addTiles(other: SelectionMask): void {
    for (const [tileX, sourceColumn] of other.tileColumns) {
      const column =
        this.tileColumns.get(tileX) ?? new Map<number, SelectionMaskTile>();
      this.tileColumns.set(tileX, column);
      for (const [tileY, source] of sourceColumn) {
        const tile = column.get(tileY);
        if (tile?.opaque) continue;
        if (tile === undefined || source.opaque)
          column.set(tileY, source.clone());
        else tile.combineInPlace(source, Math.max);
      }
    }
  }

  /** Removes whole opaque source tiles and handles fractional bytes in bulk. */
  private subtractTiles(other: SelectionMask): void {
    for (const [tileX, column] of this.tileColumns) {
      for (const [tileY, tile] of column) {
        const source = other.tileColumns.get(tileX)?.get(tileY);
        if (source === undefined) continue;
        if (source.opaque) column.delete(tileY);
        else {
          tile.combineInPlace(source, (left, right) =>
            Math.round(
              (left * (MAX_COVERAGE_BYTE - right)) / MAX_COVERAGE_BYTE,
            ),
          );
          if (tile.empty) column.delete(tileY);
        }
      }
      if (column.size === 0) this.tileColumns.delete(tileX);
    }
  }

  /** Retains only overlapping tile coverage, cloning partial sources as needed. */
  private intersectTiles(other: SelectionMask): void {
    for (const [tileX, column] of this.tileColumns) {
      for (const [tileY, tile] of column) {
        const source = other.tileColumns.get(tileX)?.get(tileY);
        if (source === undefined) column.delete(tileY);
        else if (source.opaque) continue;
        else if (tile.opaque) column.set(tileY, source.clone());
        else {
          tile.combineInPlace(source, Math.min);
          if (tile.empty) column.delete(tileY);
        }
      }
      if (column.size === 0) this.tileColumns.delete(tileX);
    }
  }

  /** Reads a stored byte at trusted coordinates without allocating absent tiles. */
  private getCoverageByte(x: number, y: number): number {
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    const tile = this.tileColumns.get(tileX)?.get(tileY);

    if (tile === undefined) {
      return 0;
    }

    const localX = x - tileX * this.tileSize;
    const localY = y - tileY * this.tileSize;
    return tile.get(localX, localY);
  }

  /** Writes a trusted byte and releases tiles whose final covered pixel clears. */
  private setCoverageByte(x: number, y: number, coverageByte: number): void {
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    const existingColumn = this.tileColumns.get(tileX);
    const existingTile = existingColumn?.get(tileY);

    if (coverageByte === 0 && existingTile === undefined) {
      return;
    }

    const column = existingColumn ?? new Map<number, SelectionMaskTile>();
    const tile = existingTile ?? new SelectionMaskTile(this.tileSize);
    if (existingColumn === undefined) {
      this.tileColumns.set(tileX, column);
    }
    if (existingTile === undefined) {
      column.set(tileY, tile);
    }

    const localX = x - tileX * this.tileSize;
    const localY = y - tileY * this.tileSize;
    tile.set(localX, localY, coverageByte);

    if (tile.empty) {
      column.delete(tileY);
      if (column.size === 0) {
        this.tileColumns.delete(tileX);
      }
    }
  }

  /** Visits allocated tiles only; callbacks may reduce coverage at visited pixels. */
  private forEachCoveredPixel(visit: SelectionCoverageVisitor): void {
    for (const [tileX, column] of this.tileColumns) {
      for (const [tileY, tile] of column) {
        const originX = tileX * this.tileSize;
        const originY = tileY * this.tileSize;
        tile.forEachCoveredPixel((localX, localY, coverageByte) => {
          visit(originX + localX, originY + localY, coverageByte);
        });
      }
    }
  }

  /** Rejects malformed composition operands before any receiver writes. */
  private static assertValidMask(
    other: unknown,
  ): asserts other is SelectionMask {
    if (!(other instanceof SelectionMask)) {
      throw ReverieTypeError.from(ErrorDefinitions.SELECTION.INVALID_MASK);
    }
  }

  /** Writes an opaque row span without allocating uncovered bounding-box tiles. */
  private fillOpaqueSpan(minimumX: number, maximumX: number, y: number): void {
    const tileY = Math.floor(y / this.tileSize);
    const localY = y - tileY * this.tileSize;
    const minimumTileX = Math.floor(minimumX / this.tileSize);
    const maximumTileX = Math.floor((maximumX - 1) / this.tileSize);
    for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
      const column =
        this.tileColumns.get(tileX) ?? new Map<number, SelectionMaskTile>();
      const tile = column.get(tileY) ?? new SelectionMaskTile(this.tileSize);
      this.tileColumns.set(tileX, column);
      column.set(tileY, tile);
      const originX = tileX * this.tileSize;
      tile.fillOpaque(
        Math.max(0, minimumX - originX),
        localY,
        Math.min(this.tileSize, maximumX - originX),
        localY + 1,
      );
    }
  }

  /** Fills a validated half-open rectangle one intersecting tile at a time. */
  private fillOpaqueRect(rect: Rect): void {
    const maximumX = rect.x + rect.width;
    const maximumY = rect.y + rect.height;
    const minimumTileX = Math.floor(rect.x / this.tileSize);
    const maximumTileX = Math.floor((maximumX - 1) / this.tileSize);
    const minimumTileY = Math.floor(rect.y / this.tileSize);
    const maximumTileY = Math.floor((maximumY - 1) / this.tileSize);

    for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
      const column = new Map<number, SelectionMaskTile>();
      this.tileColumns.set(tileX, column);
      const tileOriginX = tileX * this.tileSize;
      const localMinimumX = Math.max(0, rect.x - tileOriginX);
      const localMaximumX = Math.min(this.tileSize, maximumX - tileOriginX);

      for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
        const tileOriginY = tileY * this.tileSize;
        const localMinimumY = Math.max(0, rect.y - tileOriginY);
        const localMaximumY = Math.min(this.tileSize, maximumY - tileOriginY);
        const tile = new SelectionMaskTile(this.tileSize);
        tile.fillOpaque(
          localMinimumX,
          localMinimumY,
          localMaximumX,
          localMaximumY,
        );
        column.set(tileY, tile);
      }
    }
  }

  /** Validates one public world-pixel coordinate pair. */
  private assertValidCoordinate(x: unknown, y: unknown): void {
    if (typeof x !== "number" || typeof y !== "number") {
      const invalidName = typeof x !== "number" ? "x" : "y";
      const invalidValue = invalidName === "x" ? x : y;
      throw ReverieTypeError.from(
        ErrorDefinitions.COMMON.INVALID_COORDINATE_TYPE,
        {
          param: invalidName,
          expected: "number",
          received: typeof invalidValue,
        },
      );
    }
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        { x, y },
      );
    }
  }

  /** Validates construction bounds before any allocation or iteration. */
  private static assertValidRect(rect: unknown): asserts rect is Rect {
    const isObject = typeof rect === "object" && rect !== null;
    if (!isObject) {
      throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_RECT);
    }

    const hasFields =
      "x" in rect && "y" in rect && "width" in rect && "height" in rect;
    if (!hasFields) {
      throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_RECT);
    }

    const { x, y, width, height } = rect;
    const maximumX =
      typeof x === "number" && typeof width === "number"
        ? x + width
        : Number.NaN;
    const maximumY =
      typeof y === "number" && typeof height === "number"
        ? y + height
        : Number.NaN;
    const isValid =
      typeof x === "number" &&
      Number.isSafeInteger(x) &&
      typeof y === "number" &&
      Number.isSafeInteger(y) &&
      typeof width === "number" &&
      Number.isSafeInteger(width) &&
      width > 0 &&
      typeof height === "number" &&
      Number.isSafeInteger(height) &&
      height > 0 &&
      Number.isSafeInteger(maximumX) &&
      Number.isSafeInteger(maximumY) &&
      Number.isSafeInteger(width * height);

    if (!isValid) {
      throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_RECT);
    }
  }
}
