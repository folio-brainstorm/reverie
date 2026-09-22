import type { RenderRegionSet } from "./RenderRegionSet.js";
import type { RenderTarget } from "./RenderTarget.js";

/**
 * Platform-specific presentation boundary for resolved rendering output.
 */
export interface RendererBackend {
  /**
   * Presents Rendering Core output through a Backend-owned output target.
   *
   * @param regions - Fully resolved bounded rendering demand for one frame.
   * @param target - Output resource owned and managed by this backend.
   */
  present(regions: RenderRegionSet, target: RenderTarget): void;
}
