import { createReverieErrorBase } from "@reverie/core";

import type { ExporterErrorCode } from "../interfaces/errors/ExporterErrorCode.js";

/** Reports general Exporter failures with a stable machine-readable code. */
export class ExporterError extends createReverieErrorBase<ExporterErrorCode>(
  Error,
  "ExporterError",
) {}

/** Reports invalid Exporter ranges with a stable machine-readable code. */
export class ExporterRangeError extends createReverieErrorBase<ExporterErrorCode>(
  RangeError,
  "ExporterRangeError",
) {}

/** Reports invalid Exporter value types with a stable machine-readable code. */
export class ExporterTypeError extends createReverieErrorBase<ExporterErrorCode>(
  TypeError,
  "ExporterTypeError",
) {}
