import type { RendererErrorDefinitions } from "../../errors/RendererErrorDefinitions.js";

/** Stable machine-readable identifier emitted by `@reverie/renderer`. */
export type RendererErrorCode =
  (typeof RendererErrorDefinitions)[keyof typeof RendererErrorDefinitions]["code"];
