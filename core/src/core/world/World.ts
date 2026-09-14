import type {
  PixelCoord,
  PixelLocation,
} from "../../interfaces/pixel/PixelCoords.js";
import type { WorldConfig } from "../../interfaces/world/World.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";

import {
  DEFAULT_WORLD_TILE_SIZE,
  defaultWorldConfig,
} from "../../config/DefaultWorldConfig.js";
import { DiagnosticDefinitions } from "../../utils/diagnostic/DiagnosticDefinitions.js";
import {
  consoleDiagnosticReporter,
  reportDiagnostic,
} from "../../utils/diagnostic/Diagnostics.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { CoordConventer } from "../../utils/number/coords/CoordCoventer.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { Raster } from "../raster/Raster.js";
import { RasterLayer } from "./RasterLayer.js";

/**
 * Defines a tiled world-coordinate space and resolves pixels into tile-local
 * locations.
 */
export class World {
  private readonly config: Required<WorldConfig>;

  /** Returns a defensive copy of the finite bounds, or `null` when unbounded. */
  get bounds(): WorldBounds | null {
    const bounds = this.config.bounds;
    return bounds === null ? null : { ...bounds };
  }

  /**
   * Creates a world using explicit configuration or the current runtime defaults.
   *
   * An invalid runtime default is replaced with `DEFAULT_WORLD_TILE_SIZE` and
   * reported as a non-fatal diagnostic. An explicitly invalid size is rejected.
   *
   * @param config - Optional tile size, document bounds, and reporter overrides.
   * @throws {ReverieRangeError} Tile size or bounds are invalid.
   */
  constructor(config: WorldConfig = {}) {
    const reporter =
      config.reporter ??
      defaultWorldConfig.reporter
      //#if DEBUG
      ?? consoleDiagnosticReporter
      //#elif
      ?? void 0
      //#endif

    const bounds = config.bounds ?? null;

    if (bounds !== null && !World.isValidBounds(bounds)) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.INVALID_BOUNDS);
    }

    const ownedBounds = bounds === null ? null : { ...bounds };

    if (config.tileSize !== undefined) {
      if (!isValidTileSize(config.tileSize)) {
        throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
          tileSize: config.tileSize,
        });
      }

      this.config = {
        tileSize: config.tileSize,
        bounds: ownedBounds,
        reporter,
      };
      return;
    }

    let tileSize = defaultWorldConfig.tileSize;

    if (!isValidTileSize(tileSize)) {
      reportDiagnostic(
        reporter,
        DiagnosticDefinitions.WORLD.INVALID_DEFAULT_TILE_SIZE,
        {
          tileSize,
          fallbackTileSize: DEFAULT_WORLD_TILE_SIZE,
        },
      );
      tileSize = DEFAULT_WORLD_TILE_SIZE;
    }

    this.config = { tileSize, bounds: ownedBounds, reporter };
  }

  /**
   * Reports whether a valid world pixel lies inside this World's bounds.
   *
   * @param pixel - Safe-integer world-pixel coordinate to test.
   * @returns `true` for every valid pixel in an unbounded World, otherwise
   * whether the pixel lies in the finite half-open region.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  containsPixel(pixel: PixelCoord): boolean {
    if (!isValidCoord(pixel)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        pixel,
      );
    }

    const bounds = this.config.bounds;

    if (bounds === null) {
      return true;
    }

    return (
      pixel.x >= bounds.x &&
      pixel.x - bounds.x < bounds.width &&
      pixel.y >= bounds.y &&
      pixel.y - bounds.y < bounds.height
    );
  }

  /**
   * Creates a Raster layer sharing this World's tile size and paint bounds.
   *
   * @returns A new empty layer whose direct Raster remains unbounded while
   * layer-level Brush stamps are clipped to this World.
   */
  createRasterLayer(): RasterLayer {
    return new RasterLayer(
      new Raster({ tileSize: this.config.tileSize }),
      this.config.bounds,
    );
  }

  /**
   * Resolves a world pixel into its containing tile and tile-local coordinate.
   *
   * World coordinates may be negative, but both components must be safe integers.
   *
   * @param coord - The world-pixel coordinate to resolve.
   * @returns The containing tile coordinate and zero-based local pixel coordinate.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  locatePixel(coord: PixelCoord): PixelLocation {
    if (!isValidCoord(coord)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        coord,
      );
    }

    return CoordConventer.World.locateWorldPixel(coord, this.config.tileSize);
  }

  /** Determines whether a candidate is a valid finite World region. */
  private static isValidBounds(bounds: unknown): bounds is WorldBounds {
    if (typeof bounds !== "object" || bounds === null) {
      return false;
    }

    if (
      !("x" in bounds) ||
      !("y" in bounds) ||
      !("width" in bounds) ||
      !("height" in bounds)
    ) {
      return false;
    }

    return (
      typeof bounds.x === "number" &&
      Number.isSafeInteger(bounds.x) &&
      typeof bounds.y === "number" &&
      Number.isSafeInteger(bounds.y) &&
      typeof bounds.width === "number" &&
      Number.isSafeInteger(bounds.width) &&
      bounds.width > 0 &&
      typeof bounds.height === "number" &&
      Number.isSafeInteger(bounds.height) &&
      bounds.height > 0
    );
  }
}
