import type { WorldRect } from "../camera/WorldRect.js";
import type { Raster } from "../../core/raster/Raster.js";
import type { RasterLayer } from "../../core/world/RasterLayer.js";
import type { RasterAllocatedTileView } from "./RasterAllocatedTileView.js";
import type { RenderRequestIdentity } from "./RenderRequestIdentity.js";

/** Internal mutable state retained while a render request is progressively pulled. */
export interface RenderWorkState {
  readonly identity: RenderRequestIdentity;
  readonly viewport: WorldRect;
  readonly tileSize: number;
  readonly outputTileSize: number;
  readonly layers: readonly RasterLayer[] | null;
  readonly raster: Raster | null;
  readonly candidateIterators: readonly IterableIterator<RasterAllocatedTileView>[];
  iteratorIndex: number;
  readonly pendingCoords: RasterAllocatedTileView["coord"][];
  isTraversalComplete: boolean;
  readonly visitedWorldCoords: Set<string>;
}
