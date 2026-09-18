import type { WorldConfig } from "../interfaces/world/World.js";
// #if DEBUG
import { consoleDiagnosticReporter } from "../utils/diagnostic/Diagnostics.js";
// #endif

/** Tile edge length used when neither instance nor runtime defaults are valid. */
export const DEFAULT_WORLD_TILE_SIZE = 256;

/**
 * Process-wide defaults applied to subsequently created {@link World} instances.
 *
 * Prefer passing per-instance overrides through `WorldConfig`. If an application
 * changes this object, the new values affect only `World` instances created
 * afterward.
 */
export const defaultWorldConfig: WorldConfig = {
  tileSize: DEFAULT_WORLD_TILE_SIZE,
  // #if DEBUG
  reporter: consoleDiagnosticReporter,
  // #endif
};
