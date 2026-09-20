const SMALL_CIRCLE_AREA_NORMALIZATION = 4 / Math.PI;

/**
 * Resolves area-aware coverage for a circle smaller than one pixel in diameter.
 *
 * Exact circle-square intersection keeps the circle visible at pixel corners.
 * A smooth transition toward the ordinary distance ramp makes coverage join
 * that rule continuously at radius `0.5`, while contribution still approaches
 * zero with area as the radius approaches zero.
 *
 * @param centerX - Continuous world-space circle center on the horizontal axis.
 * @param centerY - Continuous world-space circle center on the vertical axis.
 * @param radius - Validated circle radius in the half-open range `[0, 0.5)`.
 * @param pixelX - Candidate integer world-pixel X coordinate.
 * @param pixelY - Candidate integer world-pixel Y coordinate.
 * @returns Normalized coverage in the inclusive range from zero to one.
 */
export function resolveSmallCirclePixelCoverage(
  centerX: number,
  centerY: number,
  radius: number,
  pixelX: number,
  pixelY: number,
): number {
  if (radius === 0) {
    return 0;
  }

  const deltaX = pixelX + 0.5 - centerX;
  const deltaY = pixelY + 0.5 - centerY;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const distanceCoverage = clampUnit(radius + 0.5 - distance);
  const intersectionArea = circleRectangleIntersectionArea(
    pixelX - centerX,
    pixelY - centerY,
    pixelX + 1 - centerX,
    pixelY + 1 - centerY,
    radius,
  );
  const areaCoverage = clampUnit(
    intersectionArea * SMALL_CIRCLE_AREA_NORMALIZATION,
  );
  const transition = radius * 2;
  const transitionAmount = transition * transition * (3 - 2 * transition);

  return clampUnit(
    areaCoverage * (1 - transitionAmount) + distanceCoverage * transitionAmount,
  );
}

/** Calculates exact circle-rectangle intersection area by four edge sectors. */
function circleRectangleIntersectionArea(
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): number {
  const radiusSquared = radius * radius;
  const signedArea =
    circleSegmentArea(left, top, right, top, radius, radiusSquared) +
    circleSegmentArea(right, top, right, bottom, radius, radiusSquared) +
    circleSegmentArea(right, bottom, left, bottom, radius, radiusSquared) +
    circleSegmentArea(left, bottom, left, top, radius, radiusSquared);

  return Math.abs(signedArea);
}

/** Integrates the circle-covered area contributed by one directed edge. */
function circleSegmentArea(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  radius: number,
  radiusSquared: number,
): number {
  const directionX = endX - startX;
  const directionY = endY - startY;
  const directionLengthSquared =
    directionX * directionX + directionY * directionY;
  const linearCoefficient = 2 * (startX * directionX + startY * directionY);
  const constantCoefficient = startX * startX + startY * startY - radiusSquared;
  const discriminant =
    linearCoefficient * linearCoefficient -
    4 * directionLengthSquared * constantCoefficient;
  let previousParameter = 0;
  let area = 0;

  if (discriminant > 0) {
    const rootOffset = Math.sqrt(discriminant);
    const denominator = 2 * directionLengthSquared;
    const firstRoot = (-linearCoefficient - rootOffset) / denominator;
    const secondRoot = (-linearCoefficient + rootOffset) / denominator;

    if (firstRoot > 0 && firstRoot < 1) {
      area += circleSegmentIntervalArea(
        startX,
        startY,
        directionX,
        directionY,
        previousParameter,
        firstRoot,
        radius,
        radiusSquared,
      );
      previousParameter = firstRoot;
    }

    if (secondRoot > previousParameter && secondRoot < 1) {
      area += circleSegmentIntervalArea(
        startX,
        startY,
        directionX,
        directionY,
        previousParameter,
        secondRoot,
        radius,
        radiusSquared,
      );
      previousParameter = secondRoot;
    }
  }

  return (
    area +
    circleSegmentIntervalArea(
      startX,
      startY,
      directionX,
      directionY,
      previousParameter,
      1,
      radius,
      radiusSquared,
    )
  );
}

/** Chooses triangle area inside the circle or circular-sector area outside it. */
function circleSegmentIntervalArea(
  startX: number,
  startY: number,
  directionX: number,
  directionY: number,
  startParameter: number,
  endParameter: number,
  radius: number,
  radiusSquared: number,
): number {
  if (endParameter <= startParameter) {
    return 0;
  }

  const intervalStartX = startX + directionX * startParameter;
  const intervalStartY = startY + directionY * startParameter;
  const intervalEndX = startX + directionX * endParameter;
  const intervalEndY = startY + directionY * endParameter;
  const midpointParameter = (startParameter + endParameter) / 2;
  const midpointX = startX + directionX * midpointParameter;
  const midpointY = startY + directionY * midpointParameter;
  const crossProduct =
    intervalStartX * intervalEndY - intervalStartY * intervalEndX;

  if (midpointX * midpointX + midpointY * midpointY <= radiusSquared) {
    return crossProduct / 2;
  }

  const dotProduct =
    intervalStartX * intervalEndX + intervalStartY * intervalEndY;
  return (radius * radius * Math.atan2(crossProduct, dotProduct)) / 2;
}

/** Restricts small floating-point drift to normalized coverage semantics. */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
