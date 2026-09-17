import type { ReactElement } from "react";
import { useState } from "react";

import { CanvasSetup } from "./CanvasSetup";
import type { CanvasSize } from "./interfaces/canvas/CanvasSize";
import { PaintingWorkspace } from "./PaintingWorkspace";

/** Mounts the drawing runtime only after a user commits valid dimensions. */
export function App(): ReactElement {
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null);
  return canvasSize === null ? (
    <CanvasSetup onCreate={setCanvasSize} />
  ) : (
    <PaintingWorkspace canvasSize={canvasSize} />
  );
}
