import type { ProjectPreview } from "./ProjectPreview.js";

/** Optional physical-container entries that do not alter document semantics. */
export interface ProjectContainerOptions {
  /** Non-authoritative preview asset to store under the reserved preview namespace. */
  readonly preview?: ProjectPreview;
}
