import { roundAndClampChannel } from "./RoundAndClampChannel.js";

/**
 * Computes one straight-alpha Source Over RGB byte without temporary colors.
 * @param source - Source RGB byte.
 * @param destination - Destination RGB byte.
 * @param sourceAlpha - Effective normalized source alpha, including opacity.
 * @param destinationWeight - Normalized destination alpha times inverse source alpha.
 * @param outputAlpha - Positive sum of source alpha and destination weight.
 * @returns The rounded and clamped straight-alpha output byte.
 */
export function blendSourceOverChannel(
  source: number,
  destination: number,
  sourceAlpha: number,
  destinationWeight: number,
  outputAlpha: number,
): number {
  return roundAndClampChannel(
    (source * sourceAlpha + destination * destinationWeight) / outputAlpha,
  );
}
