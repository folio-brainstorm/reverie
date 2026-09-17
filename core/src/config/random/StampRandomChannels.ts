/** Published channel IDs must never be reassigned when new features are added. */
export const STAMP_RANDOM_CHANNELS = Object.freeze({
  size: 0x00000001,
  rotation: 0x00000002,
  opacity: 0x00000003,
  scatterAlong: 0x00000004,
  scatterAcross: 0x00000005,
  spacing: 0x00000006,
});
