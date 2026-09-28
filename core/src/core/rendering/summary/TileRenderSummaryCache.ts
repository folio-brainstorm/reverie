import type { TileRenderSummary } from "../../../interfaces/renderer/TileRenderSummary.js";
import type { RasterTileView } from "../../../interfaces/renderer/RasterTileView.js";

const MAX_SUMMARIES = 1024;

/** Retains bounded alpha coverage summaries for exact Tile revisions. */
export default class TileRenderSummaryCache {
  private readonly summaries = new Map<number, TileRenderSummary>();

  /** Returns cached coverage or scans only alpha bytes after a Tile changes. */
  get(tile: RasterTileView, tileSize: number): TileRenderSummary {
    const cached = this.summaries.get(tile.tileId);
    if (cached?.revision === tile.revision) {
      return cached;
    }

    let left = tileSize;
    let top = tileSize;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const alphaOffset = (y * tileSize + x) * 4 + 3;
        if (tile.pixels[alphaOffset] === 0) {
          continue;
        }
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }

    const summary: TileRenderSummary = {
      tileId: tile.tileId,
      revision: tile.revision,
      alphaBounds:
        right === 0
          ? null
          : { x: left, y: top, width: right - left, height: bottom - top },
    };
    this.summaries.delete(tile.tileId);
    this.summaries.set(tile.tileId, summary);
    if (this.summaries.size > MAX_SUMMARIES) {
      const oldestTileId = this.summaries.keys().next().value;
      if (oldestTileId !== undefined) {
        this.summaries.delete(oldestTileId);
      }
    }
    return summary;
  }
}
