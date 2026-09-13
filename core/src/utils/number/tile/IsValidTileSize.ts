/**
 * Determines whether a value can be used as a positive integer tile edge length.
 *
 * @param tileSize - The runtime value to validate.
 * @returns Whether the value is a positive safe integer.
 */
export function isValidTileSize(tileSize: unknown): tileSize is number {
  return (
    typeof tileSize === "number" &&
    Number.isSafeInteger(tileSize) &&
    tileSize > 0
  );
}
