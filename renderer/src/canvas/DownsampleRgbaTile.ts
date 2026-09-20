const RGBA_CHANNEL_COUNT = 4;

/**
 * Area-resamples a square straight-alpha RGBA8 Tile without hidden-RGB halos.
 *
 * RGB contributions are accumulated in premultiplied form and converted back
 * to straight alpha after filtering. Fully transparent source RGB therefore
 * cannot contaminate visible output colors.
 *
 * @param source - Row-major square RGBA8 source pixels.
 * @param sourceSize - Number of pixels on each source edge.
 * @param outputSize - Number of pixels on each output edge.
 * @returns A newly allocated row-major straight-alpha RGBA8 result.
 */
export default function downsampleRgbaTile(
  source: Uint8ClampedArray,
  sourceSize: number,
  outputSize: number,
): Uint8ClampedArray {
  if (sourceSize === outputSize) {
    return source.slice();
  }

  const output = new Uint8ClampedArray(
    outputSize * outputSize * RGBA_CHANNEL_COUNT,
  );
  const sourcePixelsPerOutput = sourceSize / outputSize;
  const totalArea = sourcePixelsPerOutput * sourcePixelsPerOutput;

  for (let outputY = 0; outputY < outputSize; outputY += 1) {
    const sourceTop = outputY * sourcePixelsPerOutput;
    const sourceBottom = (outputY + 1) * sourcePixelsPerOutput;
    const firstSourceY = Math.floor(sourceTop);
    const lastSourceY = Math.ceil(sourceBottom) - 1;

    for (let outputX = 0; outputX < outputSize; outputX += 1) {
      const sourceLeft = outputX * sourcePixelsPerOutput;
      const sourceRight = (outputX + 1) * sourcePixelsPerOutput;
      const firstSourceX = Math.floor(sourceLeft);
      const lastSourceX = Math.ceil(sourceRight) - 1;
      let alphaArea = 0;
      let premultipliedRedArea = 0;
      let premultipliedGreenArea = 0;
      let premultipliedBlueArea = 0;

      for (let sourceY = firstSourceY; sourceY <= lastSourceY; sourceY += 1) {
        const verticalWeight =
          Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY);

        for (let sourceX = firstSourceX; sourceX <= lastSourceX; sourceX += 1) {
          const horizontalWeight =
            Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX);
          const areaWeight = horizontalWeight * verticalWeight;
          const sourceOffset =
            (sourceY * sourceSize + sourceX) * RGBA_CHANNEL_COUNT;
          const alpha = source[sourceOffset + 3] ?? 0;

          alphaArea += alpha * areaWeight;
          premultipliedRedArea +=
            (source[sourceOffset] ?? 0) * alpha * areaWeight;
          premultipliedGreenArea +=
            (source[sourceOffset + 1] ?? 0) * alpha * areaWeight;
          premultipliedBlueArea +=
            (source[sourceOffset + 2] ?? 0) * alpha * areaWeight;
        }
      }

      const outputOffset =
        (outputY * outputSize + outputX) * RGBA_CHANNEL_COUNT;
      output[outputOffset + 3] = Math.round(alphaArea / totalArea);

      if (alphaArea > 0) {
        output[outputOffset] = Math.round(premultipliedRedArea / alphaArea);
        output[outputOffset + 1] = Math.round(
          premultipliedGreenArea / alphaArea,
        );
        output[outputOffset + 2] = Math.round(
          premultipliedBlueArea / alphaArea,
        );
      }
    }
  }

  return output;
}
