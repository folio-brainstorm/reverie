import type { DocumentMigration } from "../../interfaces/document/DocumentMigration.js";
import type { DocumentSchemaValidator } from "../../interfaces/document/DocumentSchemaValidator.js";

import { V1_DOCUMENT_VERSION } from "../../config/document/DocumentSchema.js";
import { parseDocumentV1 } from "./ParseDocumentV1.js";

/**
 * Centralized adjacent transitions into the current document schema.
 *
 * V1 is the only development schema at present, so no production migration is
 * registered. Future releases add one transition per adjacent version here.
 */
export const CURRENT_DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

/** Validators used before and after each registered document migration step. */
export const CURRENT_DOCUMENT_SCHEMA_VALIDATORS: readonly DocumentSchemaValidator[] =
  [
    {
      version: V1_DOCUMENT_VERSION,
      validate: parseDocumentV1,
    },
  ];
