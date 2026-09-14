import type { RGBAColor } from "@reverie/core";

import {
  MAX_CHANNEL_VALUE,
  OPAQUE_ALPHA,
} from "../../../config/encoder/EncoderConstants.js";
import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import {
  ExporterRangeError,
  ExporterTypeError,
} from "../../../errors/ExporterErrors.js";

import { describeCandidate } from "../diagnostic/DescribeCandidate.js";

/**
 * Validates an optional compositing background and applies the default.
 *
 * The returned color is a fresh object, so the encoder never observes later
 * mutation of the caller's color and never hands out a shared default.
 *
 * @param value - Candidate background color, or `undefined` to accept the
 * default.
 * @param param - Option name used in the error message.
 * @param fallback - Color used when `value` is `undefined`.
 * @returns A fully opaque RGBA8 color.
 * @throws {ExporterTypeError} `value` is defined but not an RGBA8 color object.
 * @throws {ExporterRangeError} `value` is a color whose alpha is not `255`.
 *
 * @example
 * resolveOpaqueBackground(
 *   undefined,
 *   "background",
 *   { r: 255, g: 255, b: 255, a: 255 },
 * ); // => opaque white
 */
export function resolveOpaqueBackground(
  value: unknown,
  param: string,
  fallback: RGBAColor,
): RGBAColor {
  if (value === undefined) {
    return { ...fallback };
  }

  if (!isRGBAColor(value)) {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_BACKGROUND,
      { param, received: describeColorCandidate(value) },
    );
  }

  if (value.a !== OPAQUE_ALPHA) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.NON_OPAQUE_ENCODER_BACKGROUND,
      { param, received: value.a },
    );
  }

  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

/**
 * Describes a rejected background candidate for an error message.
 *
 * @param value - Rejected candidate value.
 * @returns A short description of why the value is not a usable background.
 */
function describeColorCandidate(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return describeCandidate(value);
  }

  return "an object whose `r`, `g`, `b`, and `a` are not all integers within `0..255`";
}

/**
 * Determines whether a value is an RGBA8 color with integer channels.
 *
 * @param value - Candidate color.
 * @returns Whether every channel is an integer in the inclusive `0..255` range.
 */
function isRGBAColor(value: unknown): value is RGBAColor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (
    !("r" in value) ||
    !("g" in value) ||
    !("b" in value) ||
    !("a" in value)
  ) {
    return false;
  }

  return (
    isChannel(value.r) &&
    isChannel(value.g) &&
    isChannel(value.b) &&
    isChannel(value.a)
  );
}

/**
 * Determines whether a value is a single valid RGBA8 channel.
 *
 * @param value - Candidate channel.
 * @returns Whether the value is an integer in the inclusive `0..255` range.
 */
function isChannel(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CHANNEL_VALUE
  );
}
