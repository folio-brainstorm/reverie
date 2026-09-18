import { MAX_CHANNEL_VALUE } from "../../config/color/RgbaChannelConstants.js";
import type { LayerBlendMode } from "../../interfaces/world/LayerBlendMode.js";
import { roundAndClampChannel } from "./RoundAndClampChannel.js";

/**
 * Resolves one RGB channel with a World layer blend mode.
 * @param source - Source channel byte.
 * @param destination - Destination channel byte.
 * @param mode - Blend mode selected by the source layer.
 * @returns The rounded RGBA8 channel result before Source Over alpha mixing.
 */
export function blendRgbChannel(
  source: number,
  destination: number,
  mode: LayerBlendMode,
): number {
  if (mode === "normal") {
    return source;
  }

  const sourceUnit = source / MAX_CHANNEL_VALUE;
  const destinationUnit = destination / MAX_CHANNEL_VALUE;
  let result: number;

  switch (mode) {
    case "multiply":
      result = sourceUnit * destinationUnit;
      break;
    case "screen":
      result = 1 - (1 - sourceUnit) * (1 - destinationUnit);
      break;
    case "overlay":
      result =
        destinationUnit <= 0.5
          ? 2 * sourceUnit * destinationUnit
          : 1 - 2 * (1 - sourceUnit) * (1 - destinationUnit);
      break;
    case "darken":
      result = Math.min(sourceUnit, destinationUnit);
      break;
    case "lighten":
      result = Math.max(sourceUnit, destinationUnit);
      break;
    case "add":
      result = Math.min(1, sourceUnit + destinationUnit);
      break;
  }

  return roundAndClampChannel(result * MAX_CHANNEL_VALUE);
}
