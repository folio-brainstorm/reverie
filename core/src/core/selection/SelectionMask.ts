import type { Rect } from "../../interfaces/pixel/Rect.js";
import type { SelectionMaskConfig } from "../../interfaces/selection/SelectionMaskConfig.js";

import { SelectionMaskTile } from "../../internal/selection/SelectionMaskTile.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";

const DEFAULT_SELECTION_TILE_SIZE = 256;
const MAX_COVERAGE_BYTE = 255;

/** Stores normalized world-pixel coverage in sparse, one-channel tiles. */
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
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    const tile = this.tileColumns.get(tileX)?.get(tileY);

    if (tile === undefined) {
      return 0;
    }

    const localX = x - tileX * this.tileSize;
    const localY = y - tileY * this.tileSize;
    return tile.get(localX, localY) / MAX_COVERAGE_BYTE;
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

  /** Clears all stored coverage while retaining an active empty Selection. */
  clear(): void {
    this.tileColumns.clear();
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
