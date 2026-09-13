/** Optional initial state for a camera. */
export interface CameraConfig {
  /** World-space X coordinate shown at the viewport's left edge. */
  panX?: number;

  /** World-space Y coordinate shown at the viewport's top edge. */
  panY?: number;

  /** Number of screen pixels represented by one world unit. */
  zoom?: number;
}
