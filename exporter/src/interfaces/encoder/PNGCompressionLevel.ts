/**
 * Deflate effort accepted by the PNG encoder.
 *
 * `0` stores the scanlines without compression, `6` is a balanced default, and
 * `9` spends the most effort finding repeated byte sequences. The value maps
 * directly onto the deflate level used for the PNG `IDAT` stream.
 */
export type PNGCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
