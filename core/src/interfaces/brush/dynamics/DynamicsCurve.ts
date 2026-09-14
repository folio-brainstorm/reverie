/** Maps one normalized brush input to a normalized dynamics response. */
export interface DynamicsCurve {
  /**
   * Evaluates a normalized dynamics input.
   *
   * @param input - Finite input in the inclusive range `[0, 1]`.
   * @returns A finite response in the inclusive range `[0, 1]`.
   */
  evaluate(input: number): number;
}
