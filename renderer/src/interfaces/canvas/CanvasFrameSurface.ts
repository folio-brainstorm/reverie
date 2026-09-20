/** Reusable offscreen surface that assembles contiguous LOD tiles per frame. */
export interface CanvasFrameSurface {
  /** Canvas drawn once into the visible backing buffer. */
  readonly canvas: HTMLCanvasElement;

  /** Context used to clear and assemble cached LOD tile surfaces. */
  readonly context: CanvasRenderingContext2D;
}
