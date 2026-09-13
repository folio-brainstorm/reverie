/** Lowercase ASCII letters accepted in template placeholder names. */
type LowercaseLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

/** Decimal digits accepted after the first placeholder character. */
type DecimalDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Characters that may begin a template placeholder name. */
type IdentifierStartCharacter =
  LowercaseLetter | Uppercase<LowercaseLetter> | "_";

/** Characters accepted after the start of a template placeholder name. */
type IdentifierCharacter = IdentifierStartCharacter | DecimalDigit;

/** Reads one placeholder name, stopping at the first non-identifier character. */
type TakeIdentifier<
  Source extends string,
  Result extends string = "",
> = Source extends `${infer Character}${infer Rest}`
  ? Character extends IdentifierCharacter
    ? TakeIdentifier<Rest, `${Result}${Character}`>
    : Result
  : Result;

/**
 * Extracts the names of all `$name` placeholders in a template literal.
 *
 * Placeholder names follow the same rules as the runtime regular expression:
 * they start with an ASCII letter or underscore and may then contain digits.
 * A non-literal `string` falls back to `string`, because its placeholders are
 * not known at compile time.
 */
export type TemplateParameterNames<Template extends string> =
  string extends Template
    ? string
    : Template extends `${infer Character}${infer Rest}`
      ? Character extends "$"
        ? Rest extends `${infer Start}${infer Tail}`
          ? Start extends IdentifierStartCharacter
            ? TakeIdentifier<Tail, Start> | TemplateParameterNames<Tail>
            : TemplateParameterNames<Rest>
          : never
        : TemplateParameterNames<Rest>
      : never;

/**
 * Maps every placeholder found in a template to its required runtime value.
 *
 * @typeParam Template - The message template whose placeholders become keys.
 */
export type TemplateValues<Template extends string> = {
  [Parameter in TemplateParameterNames<Template>]: unknown;
};
