import type { ExporterErrorDefinitions } from "../../errors/ExporterErrorDefinitions.js";

/** Stable machine-readable identifier emitted by `@reveriejs/exporter`. */
export type ExporterErrorCode =
  (typeof ExporterErrorDefinitions)[keyof typeof ExporterErrorDefinitions]["code"];
