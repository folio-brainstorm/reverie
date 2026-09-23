/** Input used by a strategy to choose the initial render resolution. */
export interface RenderLodRequest {
  /** Source Tile edge length in world pixels. */
  readonly tileSize: number;

  /** Requested output pixels per world pixel, when the host provides one. */
  readonly scale: number | undefined;
}

/** Chooses a stable output resolution for each rendering request. */
export interface RenderLodStrategy {
  /** Resolves the output Tile edge length for a request. */
  resolveInitialOutputTileSize(request: RenderLodRequest): number;
}
