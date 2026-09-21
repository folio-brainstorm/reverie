/**
 * Wraps binary data in a browser Blob after copying it to ArrayBuffer-backed storage.
 *
 * @param data - Bytes to copy into the Blob.
 * @param mimeType - Browser media type to associate with the bytes.
 * @returns A Blob that owns a safe copy of the supplied binary data.
 */
export function createBinaryBlob(data: Uint8Array, mimeType: string): Blob {
  // `BlobPart` requires an ArrayBuffer-backed view, while callers may supply
  // a SharedArrayBuffer-backed Uint8Array. This copy normalizes that storage.
  return new Blob([new Uint8Array(data)], { type: mimeType });
}
