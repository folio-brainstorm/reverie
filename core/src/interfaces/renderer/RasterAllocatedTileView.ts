import type { TileCoord } from "../tile/TileCoord.js";
import type { RasterTileView } from "./RasterTileView.js";

/** One sparse Raster allocation and its renderer-facing pixel view. */
export interface RasterAllocatedTileView {
  /** Tile-grid coordinate owned by the Raster. */
  readonly coord: TileCoord;

  /** Read-only live pixel view for the allocated Tile. */
  readonly tile: RasterTileView;
}
