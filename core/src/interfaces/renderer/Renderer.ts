/** Common contract implemented by renderers that produce frames explicitly. */
export interface Renderer {
  /** Produces one frame from the renderer's current inputs and state. */
  render(): void;
}
