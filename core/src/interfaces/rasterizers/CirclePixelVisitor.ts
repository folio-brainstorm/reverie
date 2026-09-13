/** Allocation-light visitor used by shared internal circle geometry. */
export type CirclePixelVisitor = (
  x: number,
  y: number,
  coverage: number,
) => void;
