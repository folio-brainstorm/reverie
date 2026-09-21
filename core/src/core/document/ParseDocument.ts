import type { DocumentReadOptions } from "../../interfaces/document/DocumentReadOptions.js";
import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";

import {
  CURRENT_DOCUMENT_VERSION,
  DOCUMENT_FORMAT,
  MINIMUM_SUPPORTED_DOCUMENT_VERSION,
} from "../../config/document/DocumentSchema.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isStableDocumentId } from "../../utils/document/IsStableDocumentId.js";
import {
  createDocumentSchemaError,
  readRequiredFeatures,
  requirePlainRecord,
} from "./DocumentSchemaGuards.js";
import { migrateDocument } from "./MigrateDocument.js";
import {
  CURRENT_DOCUMENT_MIGRATIONS,
  CURRENT_DOCUMENT_SCHEMA_VALIDATORS,
} from "./DocumentMigrationRegistry.js";
import { parseDocumentV1 } from "./ParseDocumentV1.js";

/**
 * Validates, feature-checks, migrates, and normalizes serialized document data.
 *
 * This parser returns current plain schema data only. Runtime World hydration
 * and I/O integration remain later substeps.
 *
 * @param input - Unknown in-memory serialized document value.
 * @param options - Reader capabilities for required semantic features.
 * @returns A fresh current-version V1 document with unknown optional fields removed.
 * @throws {ReverieError} The document is malformed, unsupported, or cannot migrate.
 * @throws {ReverieTypeError} Reader capability configuration is invalid.
 */
export function parseDocument(
  input: unknown,
  options: DocumentReadOptions = {},
): ReverieDocumentV1 {
  const envelope = requirePlainRecord(
    input,
    "top-level envelope",
    createDocumentSchemaError,
  );
  if (envelope.format !== DOCUMENT_FORMAT) {
    throw ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_FORMAT);
  }

  const version = requireVersion(envelope.version, "version");
  const minimumReaderVersion = requireVersion(
    envelope.minimumReaderVersion,
    "minimumReaderVersion",
  );
  if (minimumReaderVersion > CURRENT_DOCUMENT_VERSION) {
    throw ReverieError.from(
      ErrorDefinitions.DOCUMENT.UNSUPPORTED_READER_VERSION,
      {
        requiredVersion: minimumReaderVersion,
        supportedVersion: CURRENT_DOCUMENT_VERSION,
      },
    );
  }

  const requiredFeatures = readRequiredFeatures(envelope.requiredFeatures);
  const supportedFeatures = readSupportedFeatures(options.supportedFeatures);
  for (const feature of requiredFeatures) {
    if (!supportedFeatures.has(feature)) {
      throw ReverieError.from(
        ErrorDefinitions.DOCUMENT.UNSUPPORTED_DOCUMENT_FEATURE,
        { feature },
      );
    }
  }

  if (
    version < MINIMUM_SUPPORTED_DOCUMENT_VERSION ||
    version > CURRENT_DOCUMENT_VERSION
  ) {
    throw ReverieError.from(
      ErrorDefinitions.DOCUMENT.UNSUPPORTED_DOCUMENT_VERSION,
      { version },
    );
  }
  if (version === CURRENT_DOCUMENT_VERSION) {
    return parseDocumentV1(input);
  }

  return parseDocumentV1(
    migrateDocument(
      input,
      version,
      CURRENT_DOCUMENT_VERSION,
      CURRENT_DOCUMENT_MIGRATIONS,
      CURRENT_DOCUMENT_SCHEMA_VALIDATORS,
    ),
  );
}

/** Validates reader capability configuration independently of serialized input. */
function readSupportedFeatures(
  input: readonly string[] | undefined,
): Set<string> {
  if (input === undefined) {
    return new Set<string>();
  }
  if (!Array.isArray(input)) {
    throw ReverieTypeError.from(
      ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_FEATURE,
    );
  }
  const features = new Set<string>();
  for (const feature of input) {
    if (!isStableDocumentId(feature)) {
      throw ReverieTypeError.from(
        ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_FEATURE,
      );
    }
    features.add(feature);
  }
  return features;
}

/** Validates an integer schema version before compatibility decisions use it. */
function requireVersion(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw createDocumentSchemaError(`${field} must be a positive safe integer`);
  }
  return value;
}
