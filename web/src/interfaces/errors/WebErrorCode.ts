import type { WebErrorCodes } from "../../errors/WebErrorDefinitions.js";

/** Stable machine-readable identifier emitted by `@reverie/web`. */
export type WebErrorCode = (typeof WebErrorCodes)[keyof typeof WebErrorCodes];
