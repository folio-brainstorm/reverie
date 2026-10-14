/** Receives one nonempty, half-open row span of nonzero world-pixel coverage. */
export type SelectionSpanVisitor = (
  minimumX: number,
  maximumX: number,
  y: number,
) => void;
