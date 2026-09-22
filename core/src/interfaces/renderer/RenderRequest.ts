import type { WorldRect } from "../camera/WorldRect.js";
import type { RenderContext } from "./RenderContext.js";
import type { RenderSource } from "./RenderSource.js";

/**
 * All platform-independent inputs required for one rendering-core request.
 *
 * The request remains an object so future rendering inputs can be introduced
 * without changing the RenderingCore method signature.
 */
export interface RenderRequest {
  /** Raster or World whose visual state is being resolved. */
  readonly source: RenderSource;

  /** Renderer-owned runtime state that affects visual resolution. */
  readonly context: RenderContext;

  /** Complete world-space area requested for this rendering pass. */
  readonly viewport: WorldRect;
}
