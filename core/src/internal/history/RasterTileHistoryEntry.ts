import type { HistoryEntry } from "../../interfaces/history/HistoryEntry.js";
import type { RasterTileSnapshot } from "../../interfaces/history/RasterTileSnapshot.js";
import type { Raster } from "../../core/raster/Raster.js";

import {
  getRasterTilePixels,
  restoreRasterTileSnapshot,
} from "../../core/rendering/bridge/RasterRenderBridge.js";

const TILE_ENTRY_OVERHEAD_BYTES = 64;

/** Restores exact before/after snapshots for every Tile touched by one edit. */
export class RasterTileHistoryEntry implements HistoryEntry {
  /** Conservative retained Tile payload plus coordinate overhead. */
  readonly byteSize: number;

  /** Creates an immutable Raster entry from changed Tile pairs. */
  constructor(
    private readonly raster: Raster,
    private readonly before: readonly RasterTileSnapshot[],
    private readonly after: readonly RasterTileSnapshot[],
  ) {
    this.byteSize = before.reduce(
      (total, snapshot, index) =>
        total +
        TILE_ENTRY_OVERHEAD_BYTES +
        (snapshot.pixels?.byteLength ?? 0) +
        (after[index]?.pixels?.byteLength ?? 0),
      0,
    );
  }

  /** Restores every touched Tile to its exact pre-edit state. */
  undo(): void {
    this.restoreAtomically(this.before);
  }

  /** Restores every touched Tile to its exact committed post-edit state. */
  redo(): void {
    this.restoreAtomically(this.after);
  }

  /** Restores a snapshot set and compensates from live state if restoration fails. */
  private restoreAtomically(target: readonly RasterTileSnapshot[]): void {
    const original = target.map<RasterTileSnapshot>((snapshot) => ({
      coord: { ...snapshot.coord },
      pixels: getRasterTilePixels(this.raster, snapshot.coord) ?? null,
    }));
    let restoredCount = 0;
    try {
      for (const snapshot of target) {
        restoreRasterTileSnapshot(this.raster, snapshot);
        restoredCount += 1;
      }
    } catch (error) {
      try {
        for (let index = restoredCount - 1; index >= 0; index -= 1) {
          const snapshot = original[index];
          if (snapshot !== undefined) {
            restoreRasterTileSnapshot(this.raster, snapshot);
          }
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Raster history restoration and compensation both failed.",
        );
      }
      throw error;
    }
  }
}
