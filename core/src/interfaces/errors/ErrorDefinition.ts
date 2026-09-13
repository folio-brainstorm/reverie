import type { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import type {
  CodedDefinition,
  DefinitionCodeCatalog,
  DefinitionCodeOf,
} from "../definitions/CodedDefinition.js";

/**
 * A stable error code paired with its evolvable message template.
 *
 * @typeParam Code - The permanent machine-readable error identifier.
 * @typeParam Template - A message template containing optional `$name` values.
 */
export type ErrorDefinition<
  Code extends string = string,
  Template extends string = string,
> = CodedDefinition<Code, Template>;

/** Any stable error code emitted by Reverie. */
export type ErrorCode = DefinitionCodeOf<typeof ErrorDefinitions>;

/**
 * Mirrors an error-definition catalog while retaining only each entry's code.
 *
 * @typeParam Catalog - The error-definition catalog to transform.
 */
export type ErrorCodeCatalog<Catalog> = DefinitionCodeCatalog<Catalog>;
