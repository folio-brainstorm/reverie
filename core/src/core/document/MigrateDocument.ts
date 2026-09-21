import type { DocumentMigration } from "../../interfaces/document/DocumentMigration.js";
import type { DocumentSchemaValidator } from "../../interfaces/document/DocumentSchemaValidator.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";

/**
 * Applies validated deterministic adjacent migrations to isolated document data.
 *
 * Source schemas are validated before their migration runs. Each migration
 * target is immediately validated before it can advance to another step.
 *
 * @param input - Serialized data using the `fromVersion` schema.
 * @param fromVersion - Integer revision represented by `input`.
 * @param toVersion - Integer revision required by the caller.
 * @param migrations - Complete adjacent revision transitions for this path.
 * @param validators - Exact-version validators used before and after transitions.
 * @returns Normalized independent payload using the requested revision.
 * @throws {ReverieError} A required transition or validator is absent, or migration fails.
 */
export function migrateDocument(
  input: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: readonly DocumentMigration[],
  validators: readonly DocumentSchemaValidator[],
): unknown {
  if (
    !Number.isSafeInteger(fromVersion) ||
    !Number.isSafeInteger(toVersion) ||
    fromVersion > toVersion
  ) {
    throw createMigrationError(fromVersion, toVersion);
  }
  if (fromVersion === toVersion) {
    return validateVersion(
      input,
      fromVersion,
      validators,
      fromVersion,
      toVersion,
    );
  }

  let migrated: unknown;
  try {
    migrated = cloneSerializedData(input);
  } catch (cause) {
    throw createMigrationError(fromVersion, toVersion, cause);
  }

  let version = fromVersion;
  migrated = validateVersion(
    migrated,
    version,
    validators,
    fromVersion,
    toVersion,
  );
  while (version < toVersion) {
    const migration = findMigration(
      migrations,
      version,
      fromVersion,
      toVersion,
    );
    try {
      migrated = migration.migrate(migrated);
      version = migration.toVersion;
      migrated = validateVersion(
        migrated,
        version,
        validators,
        fromVersion,
        toVersion,
      );
    } catch (cause) {
      throw createMigrationError(fromVersion, toVersion, cause);
    }
  }
  return migrated;
}

/** Validates one exact schema version at the caller-selected error boundary. */
function validateVersion(
  input: unknown,
  version: number,
  validators: readonly DocumentSchemaValidator[],
  fromVersion: number,
  toVersion: number,
): unknown {
  return findValidator(validators, version, fromVersion, toVersion).validate(
    input,
  );
}

/** Finds exactly one adjacent migration or reports an incomplete registry. */
function findMigration(
  migrations: readonly DocumentMigration[],
  version: number,
  fromVersion: number,
  toVersion: number,
): DocumentMigration {
  const matches = migrations.filter(
    (candidate) =>
      candidate.fromVersion === version && candidate.toVersion === version + 1,
  );
  if (matches.length !== 1) {
    throw createMigrationError(fromVersion, toVersion);
  }
  const [migration] = matches;
  if (migration === undefined) {
    throw createMigrationError(fromVersion, toVersion);
  }
  return migration;
}

/** Finds exactly one schema validator or reports an incomplete registry. */
function findValidator(
  validators: readonly DocumentSchemaValidator[],
  version: number,
  fromVersion: number,
  toVersion: number,
): DocumentSchemaValidator {
  const matches = validators.filter(
    (candidate) => candidate.version === version,
  );
  if (matches.length !== 1) {
    throw createMigrationError(fromVersion, toVersion);
  }
  const [validator] = matches;
  if (validator === undefined) {
    throw createMigrationError(fromVersion, toVersion);
  }
  return validator;
}

/** Deep-clones supported serialized data, preserving raw binary payload semantics. */
function cloneSerializedData(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneSerializedData(entry));
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      "Serialized document migration input must be plain data or Uint8Array payloads.",
    );
  }
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneSerializedData(entry),
    });
  }
  return clone;
}

/** Builds a stable migration failure and retains a useful original cause. */
function createMigrationError(
  fromVersion: number,
  toVersion: number,
  cause?: unknown,
): ReverieError {
  const error = ReverieError.from(
    ErrorDefinitions.DOCUMENT.DOCUMENT_MIGRATION_FAILED,
    {
      fromVersion,
      toVersion,
    },
  );
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
    });
  }
  return error;
}
