import { MAX_CHANNEL_VALUE } from "../../config/color/RgbaChannelConstants.js";
import { blendSourceOverChannel } from "../../internal/color/BlendSourceOverChannel.js";
import { roundAndClampChannel } from "../../internal/color/RoundAndClampChannel.js";

/**
 * Composes one straight-alpha RGBA8 pixel into a dense destination in place.
 * Arithmetic implements Canvas Normal / Source Over with non-destructive opacity.
 * @param source - Read-only-by-contract source byte storage.
 * @param sourceOffset - Valid offset of four source channels.
 * @param destination - Destination byte storage modified in place.
 * @param destinationOffset - Valid offset of four destination channels.
 * @param opacity - Validated layer opacity in [0, 1].
 */
export function compositeRgbaSourceOverInPlace(
  source: Uint8ClampedArray,
  sourceOffset: number,
  destination: Uint8ClampedArray,
  destinationOffset: number,
  opacity: number,
): void {
  const sourceAlpha =
    ((source[sourceOffset + 3] ?? 0) / MAX_CHANNEL_VALUE) * opacity;
  if (sourceAlpha === 0) {
    return;
  }
  const destinationAlphaByte = destination[destinationOffset + 3] ?? 0;
  if (sourceAlpha === 1 || destinationAlphaByte === 0) {
    for (let channel = 0; channel < 3; channel += 1) {
      destination[destinationOffset + channel] =
        source[sourceOffset + channel] ?? 0;
    }
    destination[destinationOffset + 3] = roundAndClampChannel(
      sourceAlpha * MAX_CHANNEL_VALUE,
    );
    return;
  }
  const destinationWeight =
    (destinationAlphaByte / MAX_CHANNEL_VALUE) * (1 - sourceAlpha);
  const outputAlpha = sourceAlpha + destinationWeight;
  for (let channel = 0; channel < 3; channel += 1) {
    destination[destinationOffset + channel] = blendSourceOverChannel(
      source[sourceOffset + channel] ?? 0,
      destination[destinationOffset + channel] ?? 0,
      sourceAlpha,
      destinationWeight,
      outputAlpha,
    );
  }
  destination[destinationOffset + 3] = roundAndClampChannel(
    outputAlpha * MAX_CHANNEL_VALUE,
  );
}
