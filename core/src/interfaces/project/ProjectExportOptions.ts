import type { ProjectPreview } from "./ProjectPreview.js";

/** Optional data supplied by a host while exporting a World as a project. */
export interface ProjectExportOptions {
  /** Non-authoritative preview asset to package with the exported project. */
  readonly preview?: ProjectPreview;
}
