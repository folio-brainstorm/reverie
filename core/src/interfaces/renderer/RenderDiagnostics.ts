/** Internal measurements recorded for the most recently resolved render batch. */
export interface RenderDiagnostics {
  /** Allocated tile entries inspected while finding visible content. */
  readonly candidateTileCount: number;

  /** Visible tiles that produced an output pixel region. */
  readonly renderedTileCount: number;

  /** Bytes in newly generated RGBA8 output buffers. */
  readonly generatedPixelBytes: number;

  /** Bytes of output returned by the batch, including reused buffers. */
  readonly outputPixelBytes: number;

  /** Synchronous wall-clock duration of the resolved batch, in milliseconds. */
  readonly renderDurationMs: number;

  /** Number of output regions processed by the batch. */
  readonly processedRegionCount: number;
}
