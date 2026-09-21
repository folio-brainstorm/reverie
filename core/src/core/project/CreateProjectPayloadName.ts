import { PROJECT_RASTER_ENTRY_PREFIX } from "../../config/project/ProjectContainer.js";
import { encodeHexCodeUnits } from "../../utils/string/EncodeHexCodeUnits.js";

/**
 * Derives the unique, traversal-safe binary entry name for one Raster Tile.
 *
 * UTF-16 code units are encoded as hexadecimal so arbitrary stable Layer IDs
 * remain unambiguous without relying on host filesystem escaping rules.
 *
 * @param layerId - Stable Layer identifier that owns the Tile.
 * @param x - Safe-integer horizontal Tile coordinate.
 * @param y - Safe-integer vertical Tile coordinate.
 * @returns Deterministic project-container path for the Tile's raw RGBA8 bytes.
 */
export function createProjectPayloadName(
  layerId: string,
  x: number,
  y: number,
): string {
  return `${PROJECT_RASTER_ENTRY_PREFIX}${encodeHexCodeUnits(layerId)}/x=${x}_y=${y}.bin`;
}
