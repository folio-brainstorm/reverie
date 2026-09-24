import type {
  RenderRegion,
  RenderRequestIdentity,
} from "@reverie/core/renderer";

/** Mutable accumulation state for a single unfinished render request. */
export interface PendingFrame {
  /** Identity required for every batch merged into this frame. */
  readonly identity: RenderRequestIdentity;

  /** Regions accumulated under their stable world-bounds keys. */
  readonly regions: Map<string, RenderRegion>;

  /** Only these explicitly hinted Tile bounds may update visible coverage early. */
  readonly interactiveKeys: ReadonlySet<string>;
}
