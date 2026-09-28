import type { WorldPreviewContributor } from "../../../interfaces/renderer/WorldPreviewContributor.js";
import { downsampleRgbaTile } from "../region/DownsampleRgbaTile.js";
import { compositeRgbaSourceOverInPlace } from "./CompositeRgbaSourceOverInPlace.js";

/**
 * Samples each World contributor with premultiplied-area filtering, then blends
 * at the selected preview resolution. This intentionally differs from filtering
 * a full-resolution composite.
 * @param contributors - Ordered visible layers and their source Tile pixels.
 * @param sourceTileSize - Source Tile edge length in pixels.
 * @param outputTileSize - Selected smaller preview edge length in pixels.
 * @returns Newly allocated approximate straight-alpha RGBA8 pixels.
 */
export function composeWorldPreviewTile(
  contributors: readonly WorldPreviewContributor[],
  sourceTileSize: number,
  outputTileSize: number,
): Uint8Array {
  const composedPixels = new Uint8ClampedArray(outputTileSize ** 2 * 4);
  for (const { layer, tile } of contributors) {
    const sampledPixels = downsampleRgbaTile(
      tile.pixels,
      sourceTileSize,
      outputTileSize,
    );
    for (let offset = 0; offset < sampledPixels.length; offset += 4) {
      compositeRgbaSourceOverInPlace(
        sampledPixels,
        offset,
        composedPixels,
        offset,
        layer.opacity,
        layer.blendMode,
      );
    }
  }
  return new Uint8Array(composedPixels);
}
