import type { PAINT_MODES } from "../../config/paint/PaintModes.js";

/** Operation that a Brush stamp applies to its target Raster. */
export type PaintMode = (typeof PAINT_MODES)[number];
