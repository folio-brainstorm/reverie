import type {
  ErrorCode,
  ErrorDefinition,
} from "../../interfaces/errors/ErrorDefinition.js";
import type { TemplateValues } from "../../interfaces/TemplateValues.js";
import type { TemplateArguments } from "../../interfaces/definitions/CodedDefinition.js";
import type {
  NativeErrorConstructor,
  ReverieErrorBaseConstructor,
  ReverieErrorConstructor,
} from "../../interfaces/errors/ReverieError.js";
import { formatTemplate } from "../string/FormatTemplate.js";

/**
 * Builds a coded Reverie error base while preserving a native error prototype.
 *
 * @param NativeError - Built-in error class that determines `instanceof` behavior.
 * @param publicName - Name exposed through the resulting error's `name` property.
 * @returns An error class with stable codes and definition-based construction.
 */
export function createReverieErrorBase<Code extends string>(
  NativeError: NativeErrorConstructor,
  publicName: string,
): ReverieErrorBaseConstructor<Code> {
  return class extends NativeError {
    /** Stable machine-readable identifier for this failure. */
    readonly code: Code;

    /**
     * Creates a coded error from a definition and its inferred template values.
     *
     * @param definition - Error code and human-readable message template.
     * @param values - Values for every placeholder declared by the template.
     * @returns An instance of the concrete Reverie error subclass.
     */
    static from<
      ErrorInstance extends Error & { readonly code: Code },
      const Template extends string,
    >(
      this: ReverieErrorConstructor<Code, ErrorInstance>,
      definition: ErrorDefinition<Code, Template>,
      ...[values]: TemplateArguments<Template>
    ): ErrorInstance {
      return new this(
        definition.code,
        // The static signature already guarantees all template-derived keys;
        // this fallback only supports definitions with no placeholders.
        formatTemplate(
          definition.template,
          (values ?? {}) as TemplateValues<Template>,
        ),
      );
    }

    /**
     * Initializes the native error message and exposes its stable code.
     *
     * @param code - Permanent machine-readable error identifier.
     * @param message - Fully formatted human-readable failure description.
     */
    constructor(code: Code, message: string) {
      super(`[${code}] ${message}`);
      this.name = publicName;
      this.code = code;
    }
  };
}

/** Reports invalid runtime value types with a stable, machine-readable code. */
export class ReverieTypeError extends createReverieErrorBase<ErrorCode>(
  TypeError,
  "ReverieTypeError",
) {}

/** Reports numeric safety, range, and bounds failures with a stable code. */
export class ReverieRangeError extends createReverieErrorBase<ErrorCode>(
  RangeError,
  "ReverieRangeError",
) {}

/** Reports general engine failures with a stable, machine-readable code. */
export class ReverieError extends createReverieErrorBase<ErrorCode>(
  Error,
  "ReverieError",
) {}
