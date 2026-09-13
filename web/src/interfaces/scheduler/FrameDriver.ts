/** Callback invoked by a runtime when a requested animation frame begins. */
export type FrameCallback = (timestamp: number) => void;

/** Abstracts frame scheduling and high-resolution time across Web runtimes. */
export interface FrameDriver {
  /**
   * Requests one future animation frame.
   *
   * @param callback - Work to invoke with the runtime-provided frame timestamp.
   * @returns An opaque numeric handle accepted by {@link cancelFrame}.
   */
  requestFrame(callback: FrameCallback): number;

  /**
   * Cancels a previously requested frame.
   *
   * @param handle - Opaque handle returned by {@link requestFrame}.
   */
  cancelFrame(handle: number): void;

  /** @returns Current high-resolution time in milliseconds. */
  now(): number;
}
