/** Output settings for one bitmap export, independent of world coordinates. */
export interface ExportRenderOptions {
  /** Integer pixel enlargement multiplier in `1..16`; defaults to `1`. */
  readonly scale?: number;
}
