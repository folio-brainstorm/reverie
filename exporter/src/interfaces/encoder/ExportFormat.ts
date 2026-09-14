/**
 * Canonical identifier of an image format supported by the exporter.
 *
 * The identifier names the codec rather than the file extension, which is why
 * JPEG is identified as `"jpeg"` while its files use the `jpg` extension.
 */
export type ExportFormat = "png" | "jpeg" | "webp";
