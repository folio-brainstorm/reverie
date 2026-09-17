/**
 * Avalanches a validated uint32 using the MurmurHash3 finalizer.
 *
 * @param input - Validated unsigned 32-bit word.
 * @returns Unsigned 32-bit hash; every intermediate explicitly wraps modulo 2^32.
 */
export function hashUint32(input: number): number {
  let value = input >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
