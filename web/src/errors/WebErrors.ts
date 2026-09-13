import { createReverieErrorBase } from "@reverie/core";

import type { WebErrorCode } from "../interfaces/errors/WebErrorCode.js";

/** Reports general Web runtime failures with a stable machine-readable code. */
export class WebError extends createReverieErrorBase<WebErrorCode>(
  Error,
  "WebError",
) {}

/** Reports invalid Web runtime ranges with a stable machine-readable code. */
export class WebRangeError extends createReverieErrorBase<WebErrorCode>(
  RangeError,
  "WebRangeError",
) {}

/** Reports invalid Web runtime value types with a stable machine-readable code. */
export class WebTypeError extends createReverieErrorBase<WebErrorCode>(
  TypeError,
  "WebTypeError",
) {}
