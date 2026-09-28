import type { CoveragePlan } from "../interfaces/prefetch/CoveragePlan.js";

const TARGET_MARGIN_PX = 512;
const MIN_MARGIN_TILES = 2;
const MAX_MARGIN_TILES = 24;
const MAX_LOOKAHEAD_TILES = 16;
const LOOKAHEAD_HORIZON_MS = 160;
const MIN_DIRECTIONAL_SPEED_PX_PER_MS = 0.2;

/** Chooses bounded Tile margins from projected size and recent camera motion. */
export default class CoveragePolicy {
  /**
   * Computes coverage without changing rendering or camera state.
   * @param tileSize - Source Tile edge length in world pixels.
   * @param zoom - CSS screen pixels per world pixel.
   * @param velocityPixelsPerMs - Recent camera speed in CSS pixels per millisecond.
   * @param directionX - Horizontal sign of camera movement in world space.
   * @param directionY - Vertical sign of camera movement in world space.
   * @returns Bounded margins and directional lookahead for this frame.
   */
  static resolve(
    tileSize: number,
    zoom: number,
    velocityPixelsPerMs: number,
    directionX: -1 | 0 | 1,
    directionY: -1 | 0 | 1,
  ): CoveragePlan {
    const projectedTileSize = tileSize * zoom;
    const desiredMargin = Math.ceil(TARGET_MARGIN_PX / projectedTileSize);
    const renderMarginTiles = Math.max(
      MIN_MARGIN_TILES,
      Math.min(MAX_MARGIN_TILES, desiredMargin),
    );
    const lookaheadTiles =
      velocityPixelsPerMs < MIN_DIRECTIONAL_SPEED_PX_PER_MS
        ? 0
        : Math.min(
            MAX_LOOKAHEAD_TILES,
            Math.ceil(
              (velocityPixelsPerMs * LOOKAHEAD_HORIZON_MS) /
                projectedTileSize,
            ),
          );
    return {
      renderMarginTiles,
      retainMarginTiles:
        renderMarginTiles + Math.max(4, Math.ceil(renderMarginTiles / 2)) +
        MAX_LOOKAHEAD_TILES,
      lookaheadTiles,
      velocityPixelsPerMs,
      directionX,
      directionY,
    };
  }
}
