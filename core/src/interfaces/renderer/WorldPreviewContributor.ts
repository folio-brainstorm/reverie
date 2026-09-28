import type { RasterLayer } from "../../core/world/RasterLayer.js";
import type { RasterTileView } from "./RasterTileView.js";

/** One ordered, nonempty World contributor for a preview Tile. */
export interface WorldPreviewContributor {
  readonly layer: RasterLayer;
  readonly tile: RasterTileView;
}
