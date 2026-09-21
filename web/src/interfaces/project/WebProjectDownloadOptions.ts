import type { ProjectPreview } from "@reverie/core/project";

/** Browser-only options controlling how a project is delivered to the user. */
export interface WebProjectDownloadOptions {
  /** Suggested browser download name; defaults to `Untitled.reverie`. */
  readonly filename?: string;

  /** Optional non-authoritative preview forwarded unchanged to Core export. */
  readonly preview?: ProjectPreview;
}
