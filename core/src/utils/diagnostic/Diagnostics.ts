import type { TemplateArguments } from "../../interfaces/definitions/CodedDefinition.js";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticDefinition,
  DiagnosticReporter,
} from "../../interfaces/diagnostic/Diagnostic.js";
import type { TemplateValues } from "../../interfaces/TemplateValues.js";
import { formatTemplate } from "../string/FormatTemplate.js";

/**
 * Creates an immutable diagnostic from a definition and its template values.
 *
 * @param definition - Diagnostic metadata containing severity, code, and template.
 * @param values - Values for every placeholder declared by the template.
 * @returns A frozen diagnostic with its message fully formatted.
 */
export function createDiagnostic<const Template extends string>(
  definition: DiagnosticDefinition<DiagnosticCode, Template>,
  ...[values]: TemplateArguments<Template>
): Diagnostic {
  return Object.freeze({
    severity: definition.severity,
    code: definition.code,
    // The function signature already guarantees all template-derived keys;
    // this fallback only supports definitions with no placeholders.
    message: formatTemplate(
      definition.template,
      (values ?? {}) as TemplateValues<Template>,
    ),
  });
}

/**
 * Creates a diagnostic and synchronously forwards it to a reporter.
 *
 * @param reporter - Consumer that receives the formatted diagnostic.
 * @param definition - Diagnostic metadata used to create the report.
 * @param values - Values for every placeholder declared by the template.
 * @throws Re-throws exceptions raised by the reporter.
 */
export function reportDiagnostic<const Template extends string>(
  reporter: DiagnosticReporter | undefined,
  definition: DiagnosticDefinition<DiagnosticCode, Template>,
  ...values: TemplateArguments<Template>
): void {
  if (!reporter) return;

  reporter(createDiagnostic(definition, ...values));
}

// #if DEBUG
/**
 * Default reporter for debug
 */
export const consoleDiagnosticReporter: DiagnosticReporter = (diagnostic) => {
  const output = `[${diagnostic.code}] ${diagnostic.message}`;

  if (diagnostic.severity === "warning") {
    console.warn(output);
  } else {
    console.info(output);
  }
};
// #endif
