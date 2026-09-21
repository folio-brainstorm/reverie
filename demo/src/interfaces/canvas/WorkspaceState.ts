import type { World } from "@reverie/core";

import type { CanvasSize } from "./CanvasSize";

/** Document and display state used when mounting one painting workspace. */
export interface WorkspaceState {
  /** Fixed demo viewport dimensions derived from the active document bounds. */
  readonly canvasSize: CanvasSize;

  /** Imported document state to adopt instead of creating a new blank World. */
  readonly initialWorld?: World;

  /** Monotonic remount key that guarantees fresh Web session state per document. */
  readonly revision: number;
}
