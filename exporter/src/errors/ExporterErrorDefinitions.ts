import type { ErrorDefinition } from "@reverie/core";

/** Exporter-owned message templates paired with stable Exporter error codes. */
export const ExporterErrorDefinitions = {
  INVALID_REGION_FIELD_TYPE: {
    code: "EC_EXPORTER_0001",
    template:
      "Export region `$param` must be a number, but received `$received`.",
  },
  INVALID_REGION_COORDINATE: {
    code: "EC_EXPORTER_0002",
    template:
      "Export region `$param` must be a safe integer world pixel coordinate, but received `$received`.",
  },
  INVALID_REGION_SIZE: {
    code: "EC_EXPORTER_0003",
    template:
      "Export region `$param` must be a positive safe integer world pixel extent, but received `$received`.",
  },
  REGION_EXCEEDS_SAFE_RANGE: {
    code: "EC_EXPORTER_0004",
    template:
      "Export region exceeds the safely computable range: x `$x`, y `$y`, width `$width`, height `$height`.",
  },
  INVALID_IMAGE_TYPE: {
    code: "EC_EXPORTER_0005",
    template:
      "Encoded image must be an object with `width`, `height`, and `pixels`, but received `$received`.",
  },
  INVALID_IMAGE_FIELD_TYPE: {
    code: "EC_EXPORTER_0006",
    template:
      "Encoded image `$param` must be a number, but received `$received`.",
  },
  INVALID_IMAGE_DIMENSION: {
    code: "EC_EXPORTER_0007",
    template:
      "Encoded image `$param` must be a positive safe integer pixel extent, but received `$received`.",
  },
  INVALID_IMAGE_PIXELS_TYPE: {
    code: "EC_EXPORTER_0008",
    template:
      "Encoded image `pixels` must be a Uint8ClampedArray, but received `$received`.",
  },
  INVALID_IMAGE_PIXELS_LENGTH: {
    code: "EC_EXPORTER_0009",
    template:
      "Encoded image `pixels` must contain exactly `$expected` bytes for a `$width`x`$height` RGBA8 bitmap, but received `$received` bytes.",
  },
  IMAGE_EXCEEDS_SAFE_RANGE: {
    code: "EC_EXPORTER_0010",
    template:
      "Encoded image dimensions exceed the safely computable range: width `$width`, height `$height`.",
  },
  INVALID_ENCODER_QUALITY: {
    code: "EC_EXPORTER_0011",
    template:
      "Encoder option `$param` must be a finite number within `0..1`, but received `$received`.",
  },
  INVALID_ENCODER_COMPRESSION_LEVEL: {
    code: "EC_EXPORTER_0012",
    template:
      "Encoder option `$param` must be an integer within `0..9`, but received `$received`.",
  },
  INVALID_ENCODER_BACKGROUND: {
    code: "EC_EXPORTER_0013",
    template:
      "Encoder option `$param` must be an RGBA8 color with integer channels in `0..255`, but received `$received`.",
  },
  NON_OPAQUE_ENCODER_BACKGROUND: {
    code: "EC_EXPORTER_0014",
    template:
      "Encoder option `$param` must be fully opaque with alpha `255`, but its alpha is `$received`.",
  },
  INVALID_ENCODER_BOOLEAN_OPTION: {
    code: "EC_EXPORTER_0015",
    template:
      "Encoder option `$param` must be a boolean, but received `$received`.",
  },
  ENCODING_FAILED: {
    code: "EC_EXPORTER_0016",
    template: "Failed to encode $format image.",
  },
  MISSING_JPEG_BACKEND_BUFFER: {
    code: "EC_EXPORTER_0017",
    template:
      "JPEG encoding needs a global `Buffer`, which this runtime does not provide. Call `JPEGEncoder.installJpegJsBufferShim()` before encoding.",
  },
} as const satisfies Record<string, ErrorDefinition>;
