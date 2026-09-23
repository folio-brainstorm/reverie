/**
 * Identifies the document and viewport state that produced one render request.
 *
 * A renderer creates this value before work begins and uses it to prevent a
 * completed batch from an older source or viewport from being presented.
 */
export interface RenderRequestIdentity {
  /** Monotonically increasing identifier unique to the requesting renderer. */
  readonly requestId: number;

  /** Stable representation of the viewport and output scale for this request. */
  readonly viewportKey: string;

  /** Opaque snapshot of the source state observed when the request began. */
  readonly sourceRevision: string;
}
