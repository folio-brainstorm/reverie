import type { ReactElement } from "react";
import { useState } from "react";

import type { World } from "@reverie/core";

import { CanvasSetup } from "./CanvasSetup";
import type { CanvasSize } from "./interfaces/canvas/CanvasSize";
import type { WorkspaceState } from "./interfaces/canvas/WorkspaceState";
import { PaintingWorkspace } from "./PaintingWorkspace";
import { validateCanvasSize } from "./ValidateCanvasSize";

/** Mounts the drawing runtime only after a user commits valid dimensions. */
export function App(): ReactElement {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);

  const createWorkspace = (canvasSize: CanvasSize): void => {
    setWorkspace({ canvasSize, revision: 0 });
  };

  const importWorld = (world: World): string | null => {
    const bounds = world.bounds;
    if (bounds === null || bounds.x !== 0 || bounds.y !== 0) {
      return "This demo can open only bounded projects whose origin is (0, 0).";
    }
    const sizeError = validateCanvasSize({
      width: bounds.width,
      height: bounds.height,
    });
    if (sizeError !== null) return sizeError;
    setWorkspace((current) => ({
      canvasSize: { width: bounds.width, height: bounds.height },
      initialWorld: world,
      revision: (current?.revision ?? -1) + 1,
    }));
    return null;
  };

  return workspace === null ? (
    <CanvasSetup onCreate={createWorkspace} />
  ) : (
    <PaintingWorkspace
      key={workspace.revision}
      canvasSize={workspace.canvasSize}
      initialWorld={workspace.initialWorld}
      onImportWorld={importWorld}
    />
  );
}
