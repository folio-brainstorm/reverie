import type { DiagnosticReporter } from "../diagnostic/Diagnostic.js";
import type { WorldConfig } from "./World.js";

/** Resolved document geometry with reporting explicitly optional in release builds. */
export interface ResolvedWorldConfig extends Required<
  Omit<WorldConfig, "id" | "reporter" | "initialLayers">
> {
  reporter: DiagnosticReporter | undefined;
}
