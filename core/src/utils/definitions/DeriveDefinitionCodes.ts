import type {
  CodedDefinition,
  DefinitionCodeCatalog,
} from "../../interfaces/definitions/CodedDefinition.js";

/**
 * Derives an immutable code-only catalog from a two-level definition catalog.
 *
 * Both the outer catalog and each domain group are frozen. Definition metadata
 * such as templates and severities is intentionally omitted.
 *
 * @param catalog - Definitions grouped by their diagnostic or error domain.
 * @returns A catalog with the same keys and only stable code values.
 */
export function deriveDefinitionCodes<
  const Catalog extends Record<string, Record<string, CodedDefinition>>,
>(catalog: Catalog): DefinitionCodeCatalog<Catalog> {
  const groups: Record<string, Readonly<Record<string, string>>> = {};

  for (const [groupName, definitions] of Object.entries(catalog)) {
    groups[groupName] = Object.freeze(
      Object.fromEntries(
        Object.entries(definitions).map(([name, definition]) => [
          name,
          definition.code,
        ]),
      ),
    );
  }

  return Object.freeze(groups) as DefinitionCodeCatalog<Catalog>;
}
