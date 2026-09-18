import type { PaintMode } from "../../interfaces/paint/PaintMode.js";

import { PAINT_MODES } from "../../config/paint/PaintModes.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieTypeError } from "../../utils/errors/ReverieErrors.js";

/**
 * Returns a validated stamp paint mode, defaulting absent context to painting.
 * @param mode - Optional operation supplied by a Stroke or direct stamp.
 * @returns The supported operation that should execute for the stamp.
 * @throws {ReverieTypeError} The supplied mode is unsupported.
 */
export function resolvePaintMode(mode: unknown): PaintMode {
  if (mode === undefined) {
    return "paint";
  }
  for (const candidate of PAINT_MODES) {
    if (candidate === mode) {
      return candidate;
    }
  }
  throw ReverieTypeError.from(ErrorDefinitions.PAINT.INVALID_MODE);
}
