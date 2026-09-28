import type { RenderRegion } from "@reveriejs/core/rendering";
import type { RenderRequestIdentity } from "@reveriejs/core/rendering/internal";

/** A complete, validated collection of regions that may replace the Canvas. */
export interface PresentationFrame {
  /** Identity of the fully resolved request represented by this frame. */
  readonly identity: RenderRequestIdentity;

  /** Final regions, with absent regions intentionally removed from display. */
  readonly regions: readonly RenderRegion[];
}
