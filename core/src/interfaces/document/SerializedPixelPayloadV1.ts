/** Raw in-memory RGBA8 payload for one serialized Raster tile. */
export interface SerializedPixelPayloadV1 {
  /** Fixed uncompressed byte encoding used by the V1 development schema. */
  readonly encoding: "rgba8-raw";

  /** Row-major RGBA8 bytes owned independently by the serialized document. */
  readonly data: Uint8Array;
}
