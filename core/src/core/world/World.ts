import type {
  PixelCoord,
  PixelLocation,
} from "../../interfaces/pixel/PixelCoords.js";
import type { WorldConfig } from "../../interfaces/world/World.js";

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

/**
 * Defines a tiled world-coordinate space and resolves pixels into tile-local
 * locations.
 */
export class World {
  private readonly config: Required<WorldConfig>;

  /**
   * Creates a world using explicit configuration or the current runtime defaults.
   *
   * An invalid runtime default is replaced with `DEFAULT_WORLD_TILE_SIZE` and
   * reported as a non-fatal diagnostic. An explicitly invalid size is rejected.
   *
   * @param config - Optional tile size and diagnostic reporter overrides.
   * @throws {ReverieRangeError} An explicit tile size is not a positive safe integer.
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

    if (config.tileSize !== undefined) {
      if (!isValidTileSize(config.tileSize)) {
        throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
          tileSize: config.tileSize,
        });
      }

      this.config = { tileSize: config.tileSize, reporter };
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

    this.config = { tileSize, reporter };
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
}
