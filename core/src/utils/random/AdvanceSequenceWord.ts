const SEQUENCE_MULTIPLIER = 0x9e3779b9;

/**
 * Converts a sequence position to the shared deterministic mixing word.
 *
 * @param value - Validated uint32 stamp index or stroke sequence.
 * @returns uint32 word; increment and multiplication both wrap modulo 2^32.
 */
export function advanceSequenceWord(value: number): number {
  const sequence = value >>> 0;
  return Math.imul((sequence + 1) >>> 0, SEQUENCE_MULTIPLIER) >>> 0;
}
