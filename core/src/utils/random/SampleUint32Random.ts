import { advanceSequenceWord } from "./AdvanceSequenceWord.js";
import { hashUint32 } from "./HashUint32.js";

const UINT32_RANGE = 0x100000000;

/**
 * Samples independently addressable randomness without revalidating trusted input.
 *
 * @param strokeSeed - Validated uint32 stroke seed.
 * @param stampIndex - Validated uint32 stroke-local stamp index.
 * @param channel - Stable validated uint32 random-channel ID.
 * @returns Deterministic sample in `[0, 1)` without mutable RNG state.
 */
export function sampleUint32Random(
  strokeSeed: number,
  stampIndex: number,
  channel: number,
): number {
  const seed = strokeSeed >>> 0;
  const channelId = channel >>> 0;
  const indexWord = advanceSequenceWord(stampIndex);
  // Hash the channel first so seed and channel do not have interchangeable roles.
  const channelWord = hashUint32(channelId);
  const channelSeed = (seed ^ channelWord) >>> 0;
  const mixed = (channelSeed + indexWord) >>> 0;
  return hashUint32(mixed) / UINT32_RANGE;
}
