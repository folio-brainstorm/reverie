import type { RenderRequestIdentity } from "./RenderRequestIdentity.js";

/**
 * Opaque handle for pulling the next batch of a partial render.
 *
 * A handle is valid only for the RenderingCore instance that returned it and
 * becomes cancelled when that instance starts a newer render request.
 */
export interface RenderContinuation {
  /** Nominal member that prevents arbitrary values from being used as handles. */
  readonly isRenderContinuation: true;

  /** Identity shared by every batch that this handle can produce. */
  readonly identity: RenderRequestIdentity;
}
