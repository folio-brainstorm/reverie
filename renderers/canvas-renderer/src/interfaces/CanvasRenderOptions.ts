import type { RenderQualityMode } from "@reveriejs/core/rendering";

/** Optional host policy for one explicit Canvas render pass. */
export interface CanvasRenderOptions {
  /** Defaults to normal full-quality output. */
  readonly quality?: RenderQualityMode;

  /** Continue lower-priority warm-zone work after visible output completes. */
  readonly prefetch?: boolean;

  /** Advisory milliseconds left in the host frame; absent keeps existing warm behavior. */
  readonly remainingFrameBudgetMs?: number;
}
