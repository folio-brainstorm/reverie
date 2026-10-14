/** Pure byte operation used when two allocated selection tiles overlap. */
export type SelectionCoverageCombiner = (left: number, right: number) => number;
