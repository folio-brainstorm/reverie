import type { WorldRect } from "../camera/WorldRect.js";
import type { TileCoord } from "../tile/TileCoord.js";
import type { RenderContext } from "./RenderContext.js";
import type { RenderRequestIdentity } from "./RenderRequestIdentity.js";
import type { RenderSource } from "./RenderSource.js";

/**
 * All platform-independent inputs required for one rendering-core request.
 *
 * The request remains an object so future rendering inputs can be introduced
 * without changing the RenderingCore method signature.
 */
export interface RenderRequest {
  /**
   * Optional renderer-owned request metadata.
   *
   * RenderingCore supplies a generated identity when a caller does not need to
   * coordinate presentation across progressive batches.
   */
  readonly identity?: RenderRequestIdentity;

  /** Raster or World whose visual state is being resolved. */
  readonly source: RenderSource;

  /** Renderer-owned runtime state that affects visual resolution. */
  readonly context: RenderContext;

  /** Complete world-space area requested for this rendering pass. */
  readonly viewport: WorldRect;

  /** Synchronous drawing Tiles to resolve before normal viewport traversal. */
  readonly interactiveTiles?: readonly TileCoord[];
}
