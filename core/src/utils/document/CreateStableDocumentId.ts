let nextStableDocumentId = 0;
const fallbackProcessEntropy = Math.random().toString(36).slice(2, 10);

/**
 * Creates a serializable runtime identifier with a process-local fallback.
 *
 * Cryptographically random UUIDs avoid collisions across independently
 * created documents when available. The monotonic fallback preserves the
 * per-process uniqueness required by Core-only runtimes without requiring DOM
 * or Node-specific APIs. A process-local random segment avoids deterministic
 * collisions with IDs written by an earlier fallback-only process.
 *
 * @param prefix - Stable namespace describing the identified runtime object.
 * @returns A non-empty serializable identifier.
 */
export function createStableDocumentId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") {
    return `${prefix}-${randomUuid.call(globalThis.crypto)}`;
  }
  nextStableDocumentId += 1;
  return `${prefix}-${fallbackProcessEntropy}-${nextStableDocumentId.toString(36)}`;
}
