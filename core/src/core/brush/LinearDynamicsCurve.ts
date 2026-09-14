import type { DynamicsCurve } from "../../interfaces/brush/dynamics/DynamicsCurve.js";

/** Built-in normalized dynamics curve whose output equals its input. */
export class LinearDynamicsCurve implements DynamicsCurve {
  /**
   * Returns a normalized input unchanged.
   *
   * @param input - Finite input in the inclusive range `[0, 1]`.
   * @returns The same numeric value supplied by the caller.
   */
  evaluate(input: number): number {
    return input;
  }
}
