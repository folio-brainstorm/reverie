/** Visits one stored nonzero coverage byte at primitive pixel coordinates. */
export type SelectionCoverageVisitor = (
  x: number,
  y: number,
  coverageByte: number,
) => void;
