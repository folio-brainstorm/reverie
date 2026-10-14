import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { Rect } from "../../interfaces/pixel/Rect.js";
import type { SelectionSpanVisitor } from "../../interfaces/selection/SelectionSpanVisitor.js";
import type { PolygonVertices } from "../../interfaces/selection/PolygonVertices.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { resolvePolygonCrossingPixel } from "./ResolvePolygonCrossingPixel.js";

/**
 * Validates a finite polygon and emits opaque spans using even-odd filling.
 *
 * Pixel centers on lower/left endpoints are included; upper/right endpoints
 * are excluded. Coordinates are translated before sampling so large world
 * origins do not round away the half-pixel center offset.
 *
 * @param points - Implicitly closed world-space path with at least three vertices.
 * @param visitSpan - Receives only nonempty half-open spans inside polygon bounds.
 * @throws {ReverieRangeError} Vertices are malformed or candidate bounds are unsafe.
 */
export function rasterizePolygonSpans(
  points: readonly WorldPoint[],
  visitSpan: SelectionSpanVisitor,
): void {
  assertValidPolygon(points);
  const bounds = resolveBounds(points);
  if (bounds.width === 0 || bounds.height === 0) {
    return;
  }
  const remainingPoints = points.slice(1);

  for (let localY = 0; localY < bounds.height; localY += 1) {
    const crossings = resolveCrossings(
      remainingPoints,
      points[0],
      bounds,
      localY,
    );
    emitSpans(crossings, localY, bounds, visitSpan);
  }
}

/** Validates all vertices before performing arithmetic or invoking a visitor. */
function assertValidPolygon(
  points: unknown,
): asserts points is PolygonVertices {
  if (!Array.isArray(points) || points.length < 3) {
    throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_POLYGON, {
      reason: "Provide an array containing at least three vertices",
    });
  }
  const vertices: readonly unknown[] = points;
  for (const [index, point] of vertices.entries()) {
    const isValidPoint =
      typeof point === "object" &&
      point !== null &&
      "x" in point &&
      "y" in point &&
      typeof point.x === "number" &&
      typeof point.y === "number" &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y);
    if (!isValidPoint) {
      throw ReverieRangeError.from(ErrorDefinitions.SELECTION.INVALID_POLYGON, {
        reason: `Vertex ${index} must contain finite numeric x and y coordinates`,
      });
    }
  }
}

/** Bounds must support finite, advancing integer loops before any raster writes. */
function resolveBounds(points: PolygonVertices): Rect {
  let minimumX = points[0].x;
  let maximumX = minimumX;
  let minimumY = points[0].y;
  let maximumY = minimumY;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }

  const x = Math.floor(minimumX) || 0;
  const y = Math.floor(minimumY) || 0;
  const endX = Math.ceil(maximumX);
  const endY = Math.ceil(maximumY);
  const width = endX - x;
  const height = endY - y;
  if (
    ![x, y, endX, endY, width, height, width * height].every(
      Number.isSafeInteger,
    )
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.SELECTION.UNSAFE_POLYGON_BOUNDS,
    );
  }
  return { x, y, width, height };
}

/** Orders endpoints consistently so reversing path winding preserves rounding. */
function resolveCrossings(
  points: readonly WorldPoint[],
  first: WorldPoint,
  bounds: Rect,
  localY: number,
): number[] {
  const crossings: number[] = [];
  let previous = first;
  for (const point of points) {
    const crossing = resolvePolygonCrossingPixel(
      previous,
      point,
      bounds,
      localY,
    );
    if (crossing !== undefined) {
      crossings.push(crossing);
    }
    previous = point;
  }
  const closingCrossing = resolvePolygonCrossingPixel(
    previous,
    first,
    bounds,
    localY,
  );
  if (closingCrossing !== undefined) {
    crossings.push(closingCrossing);
  }
  crossings.sort((left, right) => left - right);
  return crossings;
}

/** Converts paired crossings into half-open spans of integer pixel addresses. */
function emitSpans(
  crossings: readonly number[],
  localY: number,
  bounds: Rect,
  visitSpan: SelectionSpanVisitor,
): void {
  let left: number | undefined;
  for (const crossing of crossings) {
    if (left === undefined) {
      left = crossing;
      continue;
    }
    const minimumX = Math.max(0, left);
    const maximumX = Math.min(bounds.width, crossing);
    if (minimumX < maximumX) {
      visitSpan(bounds.x + minimumX, bounds.x + maximumX, bounds.y + localY);
    }
    left = undefined;
  }
}
