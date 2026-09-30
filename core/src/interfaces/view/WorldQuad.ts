import type { WorldPoint } from "../camera/WorldPoint.js";

/** World corners ordered top-left, top-right, bottom-right, bottom-left. */
export type WorldQuad = readonly [
  WorldPoint,
  WorldPoint,
  WorldPoint,
  WorldPoint,
];
