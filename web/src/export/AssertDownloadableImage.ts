import type { EncodedImage } from "@reverie/exporter";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebRangeError, WebTypeError } from "../errors/WebErrors.js";

/** Structural shape inspected before an `EncodedImage` is trusted. */
interface EncodedImageShape {
  readonly data: unknown;
  readonly mimeType: unknown;
  readonly extension: unknown;
}

/**
 * Validates an untrusted value as a downloadable encoded image.
 *
 * The encoders already produce well-formed `EncodedImage` values, so this guard
 * only exists at the public boundary: JavaScript callers and values that crossed
 * a serialization boundary must not reach browser APIs in a state that would
 * trigger an empty or undefined download.
 *
 * @param image - Candidate value received by the download helper.
 * @throws {WebTypeError} `image` is not an object carrying `data`, `mimeType`, and
 * `extension`, `data` is not a `Uint8Array`, or a text field is not a non-empty
 * string.
 * @throws {WebRangeError} `data` contains no bytes.
 *
 * @example
 * assertDownloadableImage({ data: bytes, mimeType: "image/png", extension: "png" });
 */
export function assertDownloadableImage(
  image: unknown,
): asserts image is EncodedImage {
  if (!hasEncodedImageShape(image)) {
    throw WebTypeError.from(WebErrorDefinitions.INVALID_ENCODED_IMAGE);
  }

  assertByteBuffer(image.data);
  assertNonEmptyText(image.mimeType, "mimeType");
  assertNonEmptyText(image.extension, "extension");
}

/**
 * Reports whether a value carries every field an encoded image needs.
 *
 * @param value - Candidate value of unknown type.
 * @returns `true` when the value is a non-null object exposing all three fields.
 */
function hasEncodedImageShape(value: unknown): value is EncodedImageShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "mimeType" in value &&
    "extension" in value
  );
}

/**
 * Validates the encoded byte buffer.
 *
 * @param data - Candidate `data` field.
 * @throws {WebTypeError} `data` is not a `Uint8Array`.
 * @throws {WebRangeError} `data` is empty.
 */
function assertByteBuffer(data: unknown): void {
  if (!(data instanceof Uint8Array)) {
    throw WebTypeError.from(WebErrorDefinitions.INVALID_ENCODED_IMAGE_DATA, {
      received: typeof data,
    });
  }

  if (data.length === 0) {
    throw WebRangeError.from(WebErrorDefinitions.EMPTY_ENCODED_IMAGE_DATA);
  }
}

/**
 * Validates a non-empty string metadata field.
 *
 * @param value - Candidate field value.
 * @param param - Field name used in the error message.
 * @throws {WebTypeError} `value` is not a non-empty string.
 */
function assertNonEmptyText(value: unknown, param: string): void {
  if (typeof value === "string" && value.length > 0) {
    return;
  }

  throw WebTypeError.from(WebErrorDefinitions.INVALID_ENCODED_IMAGE_FIELD, {
    param,
    received: typeof value === "string" ? "an empty string" : typeof value,
  });
}
