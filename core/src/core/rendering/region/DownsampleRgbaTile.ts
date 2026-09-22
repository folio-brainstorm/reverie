const RGBA_CHANNEL_COUNT = 4;

/**
 * Area-resamples a square straight-alpha RGBA8 tile without hidden-RGB halos.
 *
 * @param source - Row-major square source pixels.
 * @param sourceSize - Source edge length in pixels.
 * @param outputSize - Requested output edge length in pixels.
 * @returns A newly allocated row-major straight-alpha RGBA8 result.
 */
export function downsampleRgbaTile(
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
    for (let outputX = 0; outputX < outputSize; outputX += 1) {
      const sourceLeft = outputX * sourcePixelsPerOutput;
      const sourceRight = (outputX + 1) * sourcePixelsPerOutput;
      let alphaArea = 0;
      let premultipliedRedArea = 0;
      let premultipliedGreenArea = 0;
      let premultipliedBlueArea = 0;
      for (
        let sourceY = Math.floor(sourceTop);
        sourceY < Math.ceil(sourceBottom);
        sourceY += 1
      ) {
        const verticalWeight =
          Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY);
        for (
          let sourceX = Math.floor(sourceLeft);
          sourceX < Math.ceil(sourceRight);
          sourceX += 1
        ) {
          const horizontalWeight =
            Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX);
          const areaWeight = horizontalWeight * verticalWeight;
          const offset = (sourceY * sourceSize + sourceX) * RGBA_CHANNEL_COUNT;
          const alpha = source[offset + 3] ?? 0;
          alphaArea += alpha * areaWeight;
          premultipliedRedArea += (source[offset] ?? 0) * alpha * areaWeight;
          premultipliedGreenArea +=
            (source[offset + 1] ?? 0) * alpha * areaWeight;
          premultipliedBlueArea +=
            (source[offset + 2] ?? 0) * alpha * areaWeight;
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
