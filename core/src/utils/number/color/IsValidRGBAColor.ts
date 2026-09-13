import type { RGBAColor } from "../../../interfaces/color/Colors.js";

/** Returns whether a value is a valid single RGBA8 channel. */
function isValidRGBAChannel(channel: unknown): channel is number {
  return (
    typeof channel === "number" &&
    Number.isInteger(channel) &&
    channel >= 0 &&
    channel <= 255
  );
}

/**
 * Determines whether a value is an RGBA8 color whose channels are integers in
 * the inclusive range from 0 to 255.
 *
 * @param color - The value to validate as an RGBA8 color.
 * @returns Whether the value contains valid red, green, blue, and alpha channels.
 */
export function isValidRGBAColor(color: unknown): color is RGBAColor {
  if (
    typeof color !== "object" ||
    color === null ||
    !("r" in color) ||
    !("g" in color) ||
    !("b" in color) ||
    !("a" in color)
  ) {
    return false;
  }

  return [color.r, color.g, color.b, color.a].every(isValidRGBAChannel);
}
