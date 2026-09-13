import type { TemplateValues } from "../../interfaces/TemplateValues.js";

/**
 * Replaces every `$name` placeholder with its corresponding value.
 *
 * When `template` is a string literal, TypeScript derives the required keys in
 * `values` from the template and exposes them through completion suggestions.
 * A placeholder without a matching runtime value is left unchanged.
 *
 * @param template - Text containing `$name` placeholders.
 * @param values - A value for each placeholder inferred from `template`.
 * @returns The template with every matching placeholder replaced.
 *
 * @example
 * formatTemplate(
 *   "x = $x, y = $y, z = $z",
 *   { x: 10, y: 20, z: 30 },
 * );
 * // => "x = 10, y = 20, z = 30"
 */
export function formatTemplate<const Template extends string>(
  template: Template,
  values: TemplateValues<Template>,
): string {
  // Regex callbacks expose the matched name as `string`; the public signature
  // has already verified the narrower template-derived keys at compile time.
  const replacements = values as Record<string, unknown>;

  return template.replace(/\$([A-Za-z_]\w*)/g, (_, key: string) => {
    // Preserve the original placeholder if no matching value exists.
    return key in replacements ? String(replacements[key]) : `$${key}`;
  });
}
