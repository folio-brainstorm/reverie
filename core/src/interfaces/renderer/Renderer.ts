/**
 * Platform-independent lifecycle contract for renderers that produce frames.
 */
export interface Renderer {
  /** Produces one frame from the renderer's current inputs and state. */
  render(): void;

  /**
   * Updates the output dimensions used for subsequent rendered frames.
   * @param width - Output width in pixels.
   * @param height - Output height in pixels.
   */
  resize(width: number, height: number): void;

  /** Releases resources owned by this renderer. */
  dispose(): void;
}
