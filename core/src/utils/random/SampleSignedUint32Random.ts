import { sampleUint32Random } from "./SampleUint32Random.js";

/**
 * Samples deterministic randomness on a symmetric signed interval.
 *
 * @param strokeSeed - Validated uint32 stroke seed.
 * @param stampIndex - Validated uint32 stroke-local stamp index.
 * @param channel - Stable validated uint32 random-channel ID.
 * @returns Deterministic sample in `[-1, 1)` without mutable RNG state.
 */
export function sampleSignedUint32Random(
  strokeSeed: number,
  stampIndex: number,
  channel: number,
): number {
  return sampleUint32Random(strokeSeed, stampIndex, channel) * 2 - 1;
}
