import { assertUint32 } from "../number/math/AssertUint32.js";
import { sampleUint32Random } from "./SampleUint32Random.js";

/**
 * Computes one stable random channel for a stamp, independent of other samples.
 *
 * @param strokeSeed - Final stroke seed, an integer in `[0, 0xffffffff]`.
 * @param stampIndex - Stroke-local stamp index in `[0, 0xffffffff]`.
 * @param channel - Stable uint32 channel ID, such as `STAMP_RANDOM_CHANNELS.size`.
 * @returns Sample in `[0, 1)`; `sample * 2 - 1` converts it to `[-1, 1)`.
 * @throws {ReverieRangeError} Any argument is outside the uint32 range.
 * @example
 * const signedSize = sampleStampRandom(123, 0, STAMP_RANDOM_CHANNELS.size) * 2 - 1;
 */
export function sampleStampRandom(
  strokeSeed: number,
  stampIndex: number,
  channel: number,
): number {
  assertUint32(strokeSeed, "strokeSeed");
  assertUint32(stampIndex, "stampIndex");
  assertUint32(channel, "channel");
  return sampleUint32Random(strokeSeed, stampIndex, channel);
}
