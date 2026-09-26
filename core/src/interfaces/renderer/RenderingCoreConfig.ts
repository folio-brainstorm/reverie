import type { RenderBudget } from "./RenderBudget.js";
import type { RenderLodStrategy } from "./RenderLodStrategy.js";

/** Internal configuration for RenderingCore's bounded render planning. */
export interface RenderingCoreConfig {
  /** Optional overrides for conservative per-batch limits. */
  readonly budget?: Partial<RenderBudget>;

  /** Strategy used to select Tile output resolution for the request. */
  readonly lodStrategy?: RenderLodStrategy;

  /** Maximum retained final pixel bytes; zero disables result caching. */
  readonly resultCacheByteBudget?: number;

  /** Enables optional per-stage timing and rolling statistics. */
  readonly diagnostics?: { readonly timings?: boolean };
}
