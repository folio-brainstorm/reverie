import type { CanvasSize } from "./CanvasSize";
import type { World } from "@reveriejs/core";

/** Dimensions committed before the drawing runtime mounts. */
export interface PaintingWorkspaceProps {
  canvasSize: CanvasSize;

  /** Imported World adoption callback owned by the top-level demo document state. */
  onImportWorld: (world: World) => string | null;

  /** Existing imported World to adopt into a newly created Web drawing runtime. */
  readonly initialWorld?: World;
}
