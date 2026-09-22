import type { RasterStatistics } from "../../../interfaces/raster/RasterStatistics.js";
import type { TileBounds } from "../../../interfaces/tile/TileBounds.js";
import type { TileCoord } from "../../../interfaces/tile/TileCoord.js";
import type { TileStoreConfig } from "../../../interfaces/tile/store/TileStore.js";

import { ErrorDefinitions } from "../../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieRangeError,
} from "../../../utils/errors/ReverieErrors.js";
import { isValidCoord } from "../../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../../utils/number/tile/IsValidTileSize.js";
import { Tile } from "../Tile.js";

/**
 * Owns a sparse collection of uniformly sized tiles addressed by tile
 * coordinates.
 *
 * Reading an absent coordinate never allocates a tile. Tiles are created only
 * through {@link create} and {@link getOrCreate}.
 */
export class TileStore {
  /** Number of pixels along each edge of every tile owned by this store. */
  readonly tileSize: number;

  /** Sparse tile storage keyed by an internal, unambiguous coordinate string. */
  private readonly tiles = new Map<string, Tile>();

  /** Incrementally maintained structure metrics for the owned sparse storage. */
  private storageStatistics: RasterStatistics = {
    tileCount: 0,
    rawPixelBytes: 0,
    tileBounds: null,
  };

  /** Whether a boundary deletion deferred coordinate-bound recomputation. */
  private hasStaleTileBounds = false;

  /** Raw RGBA8 payload bytes contributed by each uniformly sized Tile. */
  private readonly rawPixelBytesPerTile: number;

  /**
   * Creates an empty sparse tile store.
   *
   * @param config - Configuration containing the shared tile edge length.
   * @throws {ReverieRangeError} `tileSize` is not a positive safe integer.
   */
  constructor(config: TileStoreConfig) {
    const { tileSize } = config;

    if (!isValidTileSize(tileSize)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
        tileSize,
      });
    }

    this.tileSize = tileSize;
    this.rawPixelBytesPerTile = tileSize * tileSize * 4;
  }

  /**
   * Returns the number of tiles currently allocated in the sparse store.
   *
   * @returns The number of stored tiles.
   */
  get size(): number {
    return this.tiles.size;
  }

  /**
   * Returns a defensive snapshot of the current sparse-storage structure.
   *
   * The snapshot is maintained without inspecting Tile pixel payloads. A prior
   * boundary deletion may defer a coordinate-only bounds rebuild until this query.
   *
   * @returns Allocated Tile count, raw RGBA8 bytes, and Tile-coordinate extent.
   */
  getStatistics(): RasterStatistics {
    if (this.hasStaleTileBounds) {
      this.recalculateTileBounds();
      this.hasStaleTileBounds = false;
    }
    const { tileBounds } = this.storageStatistics;
    return {
      ...this.storageStatistics,
      tileBounds: tileBounds === null ? null : { ...tileBounds },
    };
  }

  /**
   * Returns the tracked raw RGBA8 payload byte count without resolving bounds.
   *
   * @returns Combined payload bytes for currently allocated Tiles.
   */
  getRawPixelBytes(): number {
    return this.storageStatistics.rawPixelBytes;
  }

  /**
   * Returns the tile at a coordinate, creating it only when absent.
   *
   * Repeated calls for the same coordinate return the same `Tile` instance.
   *
   * @param coord - Safe-integer coordinate in the tile grid.
   * @returns The existing or newly created tile.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  getOrCreate(coord: TileCoord): Tile {
    const key = this.tileCoordToKey(coord);
    const existingTile = this.tiles.get(key);

    if (existingTile !== undefined) {
      return existingTile;
    }

    const tile = this.createTile();
    this.storeTile(key, coord, tile);
    return tile;
  }

  /**
   * Returns a tile for trusted, already validated integer coordinates.
   *
   * @param x - Safe-integer horizontal tile coordinate.
   * @param y - Safe-integer vertical tile coordinate.
   * @returns The existing or newly created tile.
   */
  getOrCreateTrusted(x: number, y: number): Tile {
    const key = `${x}:${y}`;
    const existingTile = this.tiles.get(key);

    if (existingTile !== undefined) {
      return existingTile;
    }

    const tile = this.createTile();
    this.storeTile(key, { x, y }, tile);
    return tile;
  }

  /**
   * Creates, stores, and returns a new tile at an unoccupied coordinate.
   *
   * @param coord - Safe-integer coordinate in the tile grid.
   * @returns The newly allocated tile.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   * @throws {ReverieError} A tile already exists at the coordinate.
   */
  create(coord: TileCoord): Tile {
    const key = this.tileCoordToKey(coord);

    if (this.tiles.has(key)) {
      throw ReverieError.from(
        ErrorDefinitions.TILE.TILE_WAS_ALREADY_EXISTS,
        coord,
      );
    }

    const tile = this.createTile();
    this.storeTile(key, coord, tile);
    return tile;
  }

  /**
   * Reads a tile without allocating storage when the coordinate is absent.
   *
   * @param coord - Safe-integer coordinate in the tile grid.
   * @returns The stored tile, or `undefined` when none exists.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  get(coord: TileCoord): Tile | undefined {
    return this.tiles.get(this.tileCoordToKey(coord));
  }

  /**
   * Reads a tile for trusted, already validated integer coordinates.
   * @param x - Safe-integer horizontal tile coordinate.
   * @param y - Safe-integer vertical tile coordinate.
   * @returns The stored tile, or `undefined` when none exists.
   */
  getTrusted(x: number, y: number): Tile | undefined {
    return this.tiles.get(`${x}:${y}`);
  }

  /**
   * Tests whether a tile has been allocated at a coordinate without creating it.
   *
   * @param coord - Safe-integer coordinate in the tile grid.
   * @returns Whether the coordinate currently contains a tile.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  has(coord: TileCoord): boolean {
    return this.tiles.has(this.tileCoordToKey(coord));
  }

  /**
   * Removes the tile stored at a coordinate without mutating the tile itself.
   *
   * @param coord - Safe-integer coordinate in the tile grid.
   * @returns `true` when a tile was removed, or `false` when none existed.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  delete(coord: TileCoord): boolean {
    const key = this.tileCoordToKey(coord);
    if (!this.tiles.delete(key)) {
      return false;
    }

    this.removeStoredTile(coord);
    return true;
  }

  /** Removes every tile from the store. Existing external references remain valid. */
  clear(): void {
    this.tiles.clear();
    this.storageStatistics = {
      tileCount: 0,
      rawPixelBytes: 0,
      tileBounds: null,
    };
    this.hasStaleTileBounds = false;
  }

  /**
   * Visits every allocated tile without exposing the backing Map.
   *
   * @param visitor - Synchronous reader receiving each Tile and owned coordinate.
   */
  forEach(visitor: (tile: Tile, coord: TileCoord) => void): void {
    for (const [key, tile] of this.tiles) {
      const separatorIndex = key.indexOf(":");
      const x = Number(key.slice(0, separatorIndex));
      const y = Number(key.slice(separatorIndex + 1));
      visitor(tile, { x, y });
    }
  }

  /** Allocates a tile whose size is guaranteed to match this store. */
  private createTile(): Tile {
    return new Tile({ size: this.tileSize });
  }

  /** Records a newly allocated Tile in the sparse store and its metrics. */
  private storeTile(key: string, coord: TileCoord, tile: Tile): void {
    this.tiles.set(key, tile);
    const tileBounds = this.storageStatistics.tileBounds;
    this.storageStatistics.tileCount += 1;
    this.storageStatistics.rawPixelBytes += this.rawPixelBytesPerTile;
    this.storageStatistics.tileBounds = expandTileBounds(tileBounds, coord);
  }

  /** Updates metrics after removing one existing Tile without reading its pixels. */
  private removeStoredTile(coord: TileCoord): void {
    const tileBounds = this.storageStatistics.tileBounds;
    this.storageStatistics.tileCount -= 1;
    this.storageStatistics.rawPixelBytes -= this.rawPixelBytesPerTile;
    if (this.storageStatistics.tileCount === 0) {
      this.storageStatistics.tileBounds = null;
      this.hasStaleTileBounds = false;
      return;
    }

    const isBoundaryTile =
      tileBounds !== null &&
      (coord.x === tileBounds.minX ||
        coord.x === tileBounds.maxX ||
        coord.y === tileBounds.minY ||
        coord.y === tileBounds.maxY);
    if (isBoundaryTile) {
      this.hasStaleTileBounds = true;
    }
  }

  /** Rebuilds sparse coordinate bounds after deferred boundary removals. */
  private recalculateTileBounds(): void {
    let tileBounds: TileBounds | null = null;
    this.forEach((_, coord) => {
      tileBounds = expandTileBounds(tileBounds, coord);
    });
    this.storageStatistics.tileBounds = tileBounds;
  }

  /**
   * Validates a tile coordinate and encodes it as an internal collision-free key.
   *
   * @param coord - Candidate coordinate in the tile grid.
   * @returns A colon-delimited key preserving both signed components.
   */
  private tileCoordToKey(coord: TileCoord): string {
    if (!isValidCoord(coord)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        coord,
      );
    }

    return `${coord.x}:${coord.y}`;
  }
}

/** Extends optional inclusive Tile-coordinate bounds to contain one coordinate. */
function expandTileBounds(
  tileBounds: TileBounds | null,
  coord: TileCoord,
): TileBounds {
  if (tileBounds === null) {
    return { minX: coord.x, minY: coord.y, maxX: coord.x, maxY: coord.y };
  }

  return {
    minX: Math.min(tileBounds.minX, coord.x),
    minY: Math.min(tileBounds.minY, coord.y),
    maxX: Math.max(tileBounds.maxX, coord.x),
    maxY: Math.max(tileBounds.maxY, coord.y),
  };
}
