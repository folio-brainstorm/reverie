import type { World } from "../../core/world/World.js";

/** Optional document integration configured when a History controller is created. */
export interface DocumentHistoryConfig {
  /** World whose Layer mutations should be observed automatically. */
  readonly world?: World;
}
