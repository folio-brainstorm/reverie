import { createReverieErrorBase } from "@reverie/core";

import type { RendererErrorCode } from "../interfaces/errors/RendererErrorCode.js";

/** Reports general renderer failures with a stable machine-readable code. */
export class RendererError extends createReverieErrorBase<RendererErrorCode>(
  Error,
  "RendererError",
) {}

/** Reports invalid renderer ranges with a stable machine-readable code. */
export class RendererRangeError extends createReverieErrorBase<
  RendererErrorCode
  >(RangeError, "RendererRangeError") { }

/** Reports invalid renderer value types with a stable machine-readable code. */
export class RendererTypeError extends createReverieErrorBase<RendererErrorCode>(
  TypeError,
  "RendererTypeError",
) {}
