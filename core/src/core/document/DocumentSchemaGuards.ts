import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { isStableDocumentId } from "../../utils/document/IsStableDocumentId.js";

/**
 * Narrows an unknown value to a plain schema record using a caller-selected error.
 *
 * @param value - Candidate serialized object.
 * @param field - Field name included in malformed-schema diagnostics.
 * @param createError - Schema-specific error factory for the rejected value.
 * @returns The narrowed plain record.
 */
export function requirePlainRecord(
  value: unknown,
  field: string,
  createError: (reason: string) => ReverieError,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw createError(`${field} must be a plain object`);
  }
  return value;
}

/**
 * Normalizes required document features while rejecting malformed identifiers.
 *
 * @param input - Optional serialized required-feature list.
 * @returns A duplicate-free feature list in serialized order.
 * @throws {ReverieError} Feature data is malformed.
 */
export function readRequiredFeatures(input: unknown): readonly string[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw createDocumentSchemaError(
      "requiredFeatures must be an array of non-empty strings",
    );
  }
  const features = input.map((feature, index) => {
    if (!isStableDocumentId(feature)) {
      throw createDocumentSchemaError(
        `requiredFeatures[${index}] must be a non-empty string`,
      );
    }
    return feature;
  });
  if (new Set(features).size !== features.length) {
    throw createDocumentSchemaError(
      "requiredFeatures must not contain duplicates",
    );
  }
  return features;
}

/**
 * Creates a stable malformed-document schema error with field-specific context.
 *
 * @param reason - Actionable description of the violated document contract.
 * @returns Stable document-schema error.
 */
export function createDocumentSchemaError(reason: string): ReverieError {
  return ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_SCHEMA, {
    reason,
  });
}

/**
 * Creates a stable malformed-Raster schema error with field-specific context.
 *
 * @param reason - Actionable description of the violated Raster contract.
 * @returns Stable Raster-schema error.
 */
export function createRasterSchemaError(reason: string): ReverieError {
  return ReverieError.from(ErrorDefinitions.DOCUMENT.INVALID_RASTER_SCHEMA, {
    reason,
  });
}

/** Narrows JSON-like document objects without accepting runtime instances. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
