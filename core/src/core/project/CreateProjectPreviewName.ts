import { PROJECT_PREVIEW_ENTRY_PREFIX } from "../../config/project/ProjectContainer.js";
import { encodeHexCodeUnits } from "../../utils/string/EncodeHexCodeUnits.js";

/**
 * Derives a traversal-safe preview entry name that retains the preview MIME type.
 *
 * @param mimeType - Validated MIME type describing the preview bytes.
 * @returns Stable reserved entry name for the preview asset.
 */
export function createProjectPreviewName(mimeType: string): string {
  return `${PROJECT_PREVIEW_ENTRY_PREFIX}mime-${encodeHexCodeUnits(mimeType)}.bin`;
}
