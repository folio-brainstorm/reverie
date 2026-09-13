import type { RGBAColor } from "../../interfaces/color/Colors.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";

const MAX_CHANNEL_VALUE = 255;

/**
 * Composites one straight-alpha RGBA8 source color over a destination color.
 *
 * @param source - Source color placed over the destination.
 * @param destination - Existing destination color beneath the source.
 * @returns A newly allocated straight-alpha RGBA8 composite color.
 * @throws {ReverieRangeError} Either color contains a channel outside the
 * RGBA8 integer range.
 * @example
 * blendSourceOver(
 *   { r: 255, g: 0, b: 0, a: 128 },
 *   { r: 0, g: 0, b: 255, a: 255 },
 * ); // { r: 128, g: 0, b: 127, a: 255 }
 */
export function blendSourceOver(
  source: RGBAColor,
  destination: RGBAColor,
): RGBAColor {
  assertValidColor(source);
  assertValidColor(destination);

  if (source.a === 0) {
    return { ...destination };
  }

  if (source.a === MAX_CHANNEL_VALUE || destination.a === 0) {
    return { ...source };
  }

  const sourceAlpha = source.a / MAX_CHANNEL_VALUE;
  const destinationAlpha = destination.a / MAX_CHANNEL_VALUE;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);

  if (outputAlpha === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: blendChannel(
      source.r,
      destination.r,
      sourceAlpha,
      destinationAlpha,
      outputAlpha,
    ),
    g: blendChannel(
      source.g,
      destination.g,
      sourceAlpha,
      destinationAlpha,
      outputAlpha,
    ),
    b: blendChannel(
      source.b,
      destination.b,
      sourceAlpha,
      destinationAlpha,
      outputAlpha,
    ),
    a: roundAndClampChannel(outputAlpha * MAX_CHANNEL_VALUE),
  };
}

/** Rejects a color that cannot participate in RGBA8 compositing. */
function assertValidColor(color: RGBAColor): void {
  if (!isValidRGBAColor(color)) {
    throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
  }
}

/** Composites one straight-alpha RGB channel and converts it back to RGBA8. */
function blendChannel(
  source: number,
  destination: number,
  sourceAlpha: number,
  destinationAlpha: number,
  outputAlpha: number,
): number {
  const output =
    (source * sourceAlpha +
      destination * destinationAlpha * (1 - sourceAlpha)) /
    outputAlpha;

  return roundAndClampChannel(output);
}

/** Rounds a computed channel and protects RGBA8 bounds from floating-point drift. */
function roundAndClampChannel(channel: number): number {
  return Math.min(MAX_CHANNEL_VALUE, Math.max(0, Math.round(channel)));
}
