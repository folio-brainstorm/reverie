import { assertUint32 } from "../number/math/AssertUint32.js";
import { advanceSequenceWord } from "./AdvanceSequenceWord.js";
import { hashUint32 } from "./HashUint32.js";

/**
 * Derives a replayable stroke seed from a brush seed and recorded stroke sequence.
 *
 * @param brushSeed - Base uint32 seed configured by the brush.
 * @param strokeSequence - Caller-owned uint32 stroke sequence number.
 * @returns Final uint32 seed, unique across sequence values for a fixed brush seed.
 * @throws {ReverieRangeError} Either argument is outside the uint32 range.
 * @example
 * const savedStrokeSeed = deriveStrokeSeed(123, 7);
 * const replay = new Stroke({ brush, strokeSeed: savedStrokeSeed });
 */
export function deriveStrokeSeed(
  brushSeed: number,
  strokeSequence: number,
): number {
  assertUint32(brushSeed, "brush.seed");
  assertUint32(strokeSequence, "strokeSequence");
  const seed = brushSeed >>> 0;
  const sequenceWord = advanceSequenceWord(strokeSequence);
  return hashUint32((seed + sequenceWord) >>> 0);
}
