import type { TemplateArguments } from "../definitions/CodedDefinition.js";
import type { ErrorDefinition } from "./ErrorDefinition.js";

/** A constructor compatible with built-in JavaScript error classes. */
export type NativeErrorConstructor<ErrorInstance extends Error = Error> = new (
  message?: string,
) => ErrorInstance;

/** A constructor for Reverie errors carrying a stable error code. */
export type ReverieErrorConstructor<
  Code extends string,
  ErrorInstance extends Error,
> = new (code: Code, message: string) => ErrorInstance;

/** An Error instance carrying a stable machine-readable code. */
export interface CodedError<Code extends string> extends Error {
  /** Permanent identifier suitable for programmatic error handling. */
  readonly code: Code;
}

/**
 * Constructor returned by {@link createReverieErrorBase}.
 *
 * @typeParam Code - Stable codes accepted by the generated error class.
 */
export interface ReverieErrorBaseConstructor<Code extends string> {
  new (code: Code, message: string): CodedError<Code>;

  /**
   * Formats a coded definition and creates an instance of the concrete subclass.
   *
   * @param definition - Stable code and message template to format.
   * @param values - Values required by placeholders in the message template.
   * @returns An instance of the concrete error subclass.
   */
  from<
    ErrorInstance extends CodedError<Code>,
    const Template extends string,
  >(
    this: ReverieErrorConstructor<Code, ErrorInstance>,
    definition: ErrorDefinition<Code, Template>,
    ...[values]: TemplateArguments<Template>
  ): ErrorInstance;
}

/** Rest arguments inferred from placeholders in a coded message template. */
export type { TemplateArguments };
