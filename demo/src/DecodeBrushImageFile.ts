import { BrushImage } from "@reverie/core";

/**
 * Decodes a browser image file into an immutable alpha-only brush source.
 *
 * The decoded RGB channels are intentionally discarded by BrushImage so the
 * active brush color remains authoritative.
 *
 * @param file - Browser image selected by the user.
 * @returns A reusable brush image containing the decoded alpha coverage.
 * @throws {Error} The browser cannot decode the file or create a 2D canvas.
 */
export async function decodeBrushImageFile(file: Blob): Promise<BrushImage> {
  const bitmap = await decodeWithImageBitmap(file);

  if (bitmap !== null) {
    try {
      return extractBrushImage(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }

  const image = await decodeWithImageElement(file);
  return extractBrushImage(image, image.naturalWidth, image.naturalHeight);
}

/** Uses the fast bitmap decoder when it supports the supplied image format. */
async function decodeWithImageBitmap(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }

  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/** Recovers formats unsupported by createImageBitmap through an image element. */
async function decodeWithImageElement(file: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } catch (error) {
    throw new Error("The source image could not be decoded.", { cause: error });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Draws a decoded source once and extracts only its alpha channel. */
function extractBrushImage(
  source: CanvasImageSource,
  width: number,
  height: number,
): BrushImage {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context === null) {
    throw new Error("The browser could not create an image decoding canvas.");
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);

  return BrushImage.fromRGBA({
    width,
    height,
    pixels: imageData.data,
  });
}
