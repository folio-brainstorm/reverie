import type {
  FrameCallback,
  FrameDriver,
} from "../interfaces/scheduler/FrameDriver.js";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError } from "../errors/WebErrors.js";

/** Uses animation-frame and timing primitives from the current global scope. */
export class WebFrameDriver implements FrameDriver {
  /**
   * Verifies that the current main-thread or Dedicated Worker scope can drive
   * frame-based work without a timer fallback.
   *
   * @throws {WebError} Required animation-frame or timing primitives are absent.
   */
  constructor() {
    const hasRequestFrame =
      typeof globalThis.requestAnimationFrame === "function";
    const hasCancelFrame =
      typeof globalThis.cancelAnimationFrame === "function";
    const hasHighResolutionClock =
      typeof globalThis.performance?.now === "function";

    if (!hasRequestFrame || !hasCancelFrame || !hasHighResolutionClock) {
      throw WebError.from(WebErrorDefinitions.FRAME_SCHEDULING_UNAVAILABLE);
    }
  }

  /**
   * Requests one animation frame from the current global scope.
   *
   * @param callback - Work invoked with the runtime-provided frame timestamp.
   * @returns The runtime's opaque animation-frame handle.
   */
  requestFrame(callback: FrameCallback): number {
    return globalThis.requestAnimationFrame(callback);
  }

  /**
   * Cancels an animation frame in the current global scope.
   *
   * @param handle - Handle returned by {@link requestFrame}.
   */
  cancelFrame(handle: number): void {
    globalThis.cancelAnimationFrame(handle);
  }

  /** @returns Current high-resolution time in milliseconds. */
  now(): number {
    return globalThis.performance.now();
  }
}
