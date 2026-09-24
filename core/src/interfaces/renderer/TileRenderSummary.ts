import type { Rect } from "../pixel/Rect.js";

/** Renderer-only alpha coverage for one exact Tile pixel revision. */
export interface TileRenderSummary {
  readonly tileId: number;
  readonly revision: number;
  readonly alphaBounds: Rect | null;
}
