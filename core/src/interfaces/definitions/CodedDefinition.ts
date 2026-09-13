import type {
  TemplateParameterNames,
  TemplateValues,
} from "../TemplateValues.js";

/** A stable code paired with an evolvable message template. */
export interface CodedDefinition<
  Code extends string = string,
  Template extends string = string,
> {
  /** Stable machine-readable identifier that must not be reused. */
  readonly code: Code;

  /** Human-readable message template whose wording may evolve. */
  readonly template: Template;
}

/**
 * Recursively extracts the union of code literals from a definition catalog.
 *
 * @typeParam Catalog - A nested definition object or individual definition.
 */
export type DefinitionCodeOf<Catalog> =
  Catalog extends CodedDefinition<infer Code, string>
    ? Code
    : Catalog extends object
      ? {
          [Key in keyof Catalog]: DefinitionCodeOf<Catalog[Key]>;
        }[keyof Catalog]
      : never;

/**
 * Mirrors a two-level definition catalog while retaining only each entry's code.
 *
 * @typeParam Catalog - A catalog grouped by diagnostic or error domain.
 */
export type DefinitionCodeCatalog<Catalog> = {
  readonly [Group in keyof Catalog]: {
    readonly [
      Name in keyof Catalog[Group]
    ]: Catalog[Group][Name] extends CodedDefinition<infer Code, string>
      ? Code
      : never;
  };
};

/**
 * Defines a rest tuple that requires values only when a template has placeholders.
 *
 * @typeParam Template - The message template whose placeholders are inspected.
 */
export type TemplateArguments<Template extends string> = [
  TemplateParameterNames<Template>,
] extends [never]
  ? [values?: TemplateValues<Template>]
  : [values: TemplateValues<Template>];
