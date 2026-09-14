import type { WebErrorDefinitions } from "../../errors/WebErrorDefinitions.js";

/** Stable machine-readable identifier emitted by `@reverie/web`. */
export type WebErrorCode =
  (typeof WebErrorDefinitions)[keyof typeof WebErrorDefinitions]["code"];
