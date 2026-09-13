/**
 * An RGBA8 color whose channels are integers in the inclusive range `0..255`.
 */
export interface RGBAColor {
  /** Red-channel intensity. */
  r: number;

  /** Green-channel intensity. */
  g: number;

  /** Blue-channel intensity. */
  b: number;

  /** Alpha-channel opacity, where `0` is transparent and `255` is opaque. 0 ~ 255 not 0 ~ 100 */
  a: number;
}
