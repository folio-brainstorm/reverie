/** Affine matrix mapping world coordinates to CSS screen pixels. */
export interface ViewTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}
