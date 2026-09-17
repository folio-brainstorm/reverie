import type { CanvasSize } from "./CanvasSize";

/** Receives a valid size only after the user submits the setup form. */
export interface CanvasSetupProps {
  onCreate: (size: CanvasSize) => void;
}
