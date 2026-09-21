/**
 * Encodes every UTF-16 code unit as four lowercase hexadecimal digits.
 *
 * @param value - Text whose code units should become path-safe ASCII.
 * @returns Fixed-width hexadecimal representation that preserves JavaScript strings.
 */
export function encodeHexCodeUnits(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}
