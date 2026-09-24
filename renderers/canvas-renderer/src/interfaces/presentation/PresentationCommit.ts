import type { WorldRect } from "@reverie/core";

import type { PresentationFrame } from "./PresentationFrame.js";

/** Complete replacement and the old coverage it explicitly removes. */
export interface PresentationCommit {
  /** Complete accumulated result that becomes visible for this request. */
  readonly frame: PresentationFrame;

  /** Previous region coverage absent from the completed result. */
  readonly removedBounds: readonly WorldRect[];
}
