import {
  DEFAULT_PRESSURE,
  DEFAULT_TILT_X,
  DEFAULT_TILT_Y,
} from "@reverie/core";

import type { PointerStrokeInput } from "../interfaces/input/PointerStrokeInput.js";

/** Pointer type whose pressure Rêverie trusts as a real measurement. */
const PEN_POINTER_TYPE = "pen";

/**
 * Resolves browser pointer state into normalized stroke input for Core.
 *
 * Only pen pointers publish a trustworthy pressure, so mouse and touch always
 * resolve to the Core default. Pen pressure is used only when the browser
 * reports a finite value inside `(0, 1]`, because browsers emit `0` or
 * synthetic values when no real sensor data exists. Tilt falls back to its Core
 * default when the reported angle is not finite.
 *
 * @param pointerEvent - Pointer event that contributed one stroke sample.
 * @returns Normalized pressure and tilt ready to attach to a stroke sample.
 */
export function resolvePointerStrokeInput(
  pointerEvent: PointerEvent,
): PointerStrokeInput {
  return {
    pressure: resolvePressure(pointerEvent),
    tiltX: resolveTilt(pointerEvent.tiltX, DEFAULT_TILT_X),
    tiltY: resolveTilt(pointerEvent.tiltY, DEFAULT_TILT_Y),
  };
}

/** Resolves a trustworthy normalized pressure or the Core default. */
function resolvePressure(pointerEvent: PointerEvent): number {
  if (pointerEvent.pointerType !== PEN_POINTER_TYPE) {
    return DEFAULT_PRESSURE;
  }

  const pressure = pointerEvent.pressure;

  return Number.isFinite(pressure) && pressure > 0 && pressure <= 1
    ? pressure
    : DEFAULT_PRESSURE;
}

/** Resolves a finite tilt angle or the supplied Core default. */
function resolveTilt(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
