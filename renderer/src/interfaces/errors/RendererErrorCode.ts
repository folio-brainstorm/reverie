import type { RendererErrorCodes } from "../../errors/RendererErrorDefinitions.js";

/** Stable machine-readable identifier emitted by `@reverie/renderer`. */
export type RendererErrorCode =
  (typeof RendererErrorCodes)[keyof typeof RendererErrorCodes];
