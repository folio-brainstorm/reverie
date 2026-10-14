import type { WorldPoint } from "../camera/WorldPoint.js";

/** Validated finite polygon path with at least three supplied vertices. */
export type PolygonVertices = readonly [
  WorldPoint,
  WorldPoint,
  WorldPoint,
  ...WorldPoint[],
];
