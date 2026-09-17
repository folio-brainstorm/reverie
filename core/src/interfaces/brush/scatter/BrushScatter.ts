/** Position variation applied to the final paint location of each stamp. */
export interface BrushScatter {
  /** Maximum displacement along the stroke direction, as a size ratio. */
  readonly along?: number;

  /** Maximum displacement across the stroke direction, as a size ratio. */
  readonly across?: number;
}
