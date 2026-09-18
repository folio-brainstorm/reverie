import { MAX_CHANNEL_VALUE } from "../../config/color/RgbaChannelConstants.js";

/**
 * Rounds a computed color channel while protecting byte bounds from float drift.
 * @param channel - Finite computed channel in byte units.
 * @returns An integer in the inclusive RGBA8 range.
 */
export function roundAndClampChannel(channel: number): number {
  return Math.min(MAX_CHANNEL_VALUE, Math.max(0, Math.round(channel)));
}
