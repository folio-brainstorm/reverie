import type { TileStoreConfig } from "../../../interfaces/tile/store/TileStore.js";
import type { TileCoord } from "../../../interfaces/tile/TileCoord.js";

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
    this.tiles.set(key, tile);
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
    this.tiles.set(key, tile);
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
    this.tiles.set(key, tile);
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
    return this.tiles.delete(this.tileCoordToKey(coord));
  }

  /** Removes every tile from the store. Existing external references remain valid. */
  clear(): void {
    this.tiles.clear();
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
