/** Configuration for a sparse world-space selection coverage mask. */
export interface SelectionMaskConfig {
  /** Number of coverage pixels along each internal tile edge. Defaults to `256`. */
  readonly tileSize?: number;
}
