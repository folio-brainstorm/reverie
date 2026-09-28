import type { WorldRect } from "@reverie/core";
import type { RenderQualityMode } from "@reverie/core/rendering";
import type { RenderResultClass } from "@reverie/core/rendering/internal";

/** View and actual output resolution that make retained pixels safe to reuse. */
export interface PresentationCacheContext {
  readonly viewport: WorldRect;
  readonly sourceRevision: string;
  readonly scaleKey: string;
  readonly quality: RenderQualityMode;
  readonly outputTileSize: number;
  readonly resultClass?: RenderResultClass;
}
