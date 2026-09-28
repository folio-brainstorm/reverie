import type { WorldRect } from "@reveriejs/core";
import type { RenderQualityMode } from "@reveriejs/core/rendering";
import type { RenderResultClass } from "@reveriejs/core/rendering/internal";

/** View and actual output resolution that make retained pixels safe to reuse. */
export interface PresentationCacheContext {
  readonly viewport: WorldRect;
  readonly sourceRevision: string;
  readonly scaleKey: string;
  readonly quality: RenderQualityMode;
  readonly outputTileSize: number;
  readonly resultClass?: RenderResultClass;
}
