import type { DiagnosticDefinitions } from "../../utils/diagnostic/DiagnosticDefinitions.js";
import type {
  CodedDefinition,
  DefinitionCodeOf,
} from "../definitions/CodedDefinition.js";

/** Supported severity levels for non-fatal engine diagnostics. */
export type DiagnosticSeverity = "info" | "warning";

/** A coded diagnostic template paired with its reporting severity. */
export interface DiagnosticDefinition<
  Code extends string = string,
  Template extends string = string,
> extends CodedDefinition<Code, Template> {
  /** Determines which reporting channel should receive the diagnostic. */
  readonly severity: DiagnosticSeverity;
}

/** Any stable diagnostic code declared by the engine. */
export type DiagnosticCode = DefinitionCodeOf<typeof DiagnosticDefinitions>;

/** An immutable diagnostic ready to be delivered to a reporter. */
export interface Diagnostic {
  /** Severity assigned by the originating diagnostic definition. */
  readonly severity: DiagnosticSeverity;

  /** Stable machine-readable diagnostic identifier. */
  readonly code: DiagnosticCode;

  /** Fully formatted, human-readable diagnostic message. */
  readonly message: string;
}

/** Receives one formatted non-fatal diagnostic. */
export type DiagnosticReporter = (diagnostic: Diagnostic) => void;
