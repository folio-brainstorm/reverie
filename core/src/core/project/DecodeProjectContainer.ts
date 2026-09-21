import type { DocumentReadOptions } from "../../interfaces/document/DocumentReadOptions.js";
import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";
import type { DecodedProjectDocument } from "../../interfaces/project/DecodedProjectDocument.js";
import type { ProjectManifestV1 } from "../../interfaces/project/ProjectManifestV1.js";

import {
  PROJECT_CONTAINER_HEADER_BYTES,
  PROJECT_CONTAINER_MAGIC,
  PROJECT_CONTAINER_MAGIC_BYTES,
  PROJECT_CONTAINER_MAX_ENTRY_COUNT,
  PROJECT_CONTAINER_UINT32_BYTES,
  PROJECT_CONTAINER_VERSION,
  PROJECT_DOCUMENT_ENTRY,
  PROJECT_FORMAT,
  PROJECT_MANIFEST_ENTRY,
  PROJECT_PREVIEW_ENTRY_PREFIX,
  PROJECT_RASTER_ENTRY_PREFIX,
} from "../../config/project/ProjectContainer.js";
import { parseDocument } from "../document/ParseDocument.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { isPlainRecord } from "../../utils/object/IsPlainRecord.js";
import { createProjectPayloadName } from "./CreateProjectPayloadName.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const rasterEntryPattern = new RegExp(
  `^${PROJECT_RASTER_ENTRY_PREFIX}[0-9a-f]+/x=-?(?:0|[1-9]\\d*)_y=-?(?:0|[1-9]\\d*)\\.bin$`,
);
const previewEntryPattern = new RegExp(
  `^${PROJECT_PREVIEW_ENTRY_PREFIX}(?!\\.\\.?$)[A-Za-z0-9._-]+$`,
);

/**
 * Decodes and validates `.reverie` project bytes into a complete Step 28
 * document snapshot. No partial document is returned for malformed input.
 *
 * @param bytes - Untrusted project-container bytes.
 * @param options - Reader capabilities used to validate document required features.
 * @returns A fresh validated serialized document ready for normal hydration.
 * @throws {ReverieError} The project container or its document data is invalid.
 */
export function decodeProjectContainer(
  bytes: Uint8Array,
  options: DocumentReadOptions = {},
): ReverieDocumentV1 {
  if (!(bytes instanceof Uint8Array)) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
  const entries = readEntries(bytes);
  const manifestBytes = entries.get(PROJECT_MANIFEST_ENTRY);
  if (manifestBytes === undefined) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST);
  }
  const manifest = parseManifest(manifestBytes);
  const documentBytes = entries.get(PROJECT_DOCUMENT_ENTRY);
  if (documentBytes === undefined) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.MISSING_PROJECT_DOCUMENT);
  }
  const decoded = decodeProjectDocument(
    parseJson(documentBytes, ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT),
    entries,
    options,
  );
  assertManifestMatchesDocument(manifest, decoded.document);
  assertAllPayloadsAreReferenced(entries, decoded.referencedPayloads);
  if (decoded.referencedPayloads.size === 0) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.EMPTY_PROJECT);
  }
  return decoded.document;
}

/** Reads a bounded stream of uniquely named, traversal-safe container entries. */
function readEntries(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (
    bytes.byteLength < PROJECT_CONTAINER_HEADER_BYTES ||
    !hasValidMagic(bytes)
  ) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PROJECT_CONTAINER_MAGIC_BYTES;
  const entryCount = readUint32(view, offset, bytes.byteLength);
  offset += PROJECT_CONTAINER_UINT32_BYTES;
  if (entryCount > PROJECT_CONTAINER_MAX_ENTRY_COUNT) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = readUint32(view, offset, bytes.byteLength);
    offset += PROJECT_CONTAINER_UINT32_BYTES;
    assertAvailable(offset, nameLength, bytes.byteLength);
    const name = decodeText(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const dataLength = readUint32(view, offset, bytes.byteLength);
    offset += PROJECT_CONTAINER_UINT32_BYTES;
    assertAvailable(offset, dataLength, bytes.byteLength);
    if (!isValidEntryName(name)) {
      throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD);
    }
    if (entries.has(name)) {
      throw ReverieError.from(
        ErrorDefinitions.PROJECT.DUPLICATE_PROJECT_ENTRY,
        {
          entry: name,
        },
      );
    }
    entries.set(name, bytes.subarray(offset, offset + dataLength));
    offset += dataLength;
  }
  if (offset !== bytes.byteLength) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
  return entries;
}

/** Checks the fixed byte marker without decoding untrusted text. */
function hasValidMagic(bytes: Uint8Array): boolean {
  const magic = textEncoder.encode(PROJECT_CONTAINER_MAGIC);
  return magic.every((value, index) => bytes[index] === value);
}

/** Reads one little-endian uint32 after proving the field fits in input bytes. */
function readUint32(view: DataView, offset: number, length: number): number {
  assertAvailable(offset, PROJECT_CONTAINER_UINT32_BYTES, length);
  return view.getUint32(offset, true);
}

/** Rejects length declarations that point outside the supplied byte array. */
function assertAvailable(
  offset: number,
  required: number,
  length: number,
): void {
  if (required > length - offset) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
}

/** Decodes UTF-8 metadata while rejecting malformed byte sequences. */
function decodeText(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_FORMAT);
  }
}

/** Allows only required entries, deterministic Raster entries, and reserved previews. */
function isValidEntryName(name: string): boolean {
  return (
    name === PROJECT_MANIFEST_ENTRY ||
    name === PROJECT_DOCUMENT_ENTRY ||
    rasterEntryPattern.test(name) ||
    previewEntryPattern.test(name)
  );
}

/** Parses JSON metadata and maps malformed text or syntax to one project error. */
function parseJson(
  bytes: Uint8Array,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): unknown {
  try {
    return JSON.parse(decodeText(bytes));
  } catch {
    throwProjectInputError(definition);
  }
}

/** Validates manifest compatibility before document payloads are hydrated. */
function parseManifest(bytes: Uint8Array): ProjectManifestV1 {
  const input = requirePlainRecord(
    parseJson(bytes, ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST),
    ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST,
  );
  if (input.format !== PROJECT_FORMAT) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST);
  }
  const containerVersion = requirePositiveInteger(
    input.containerVersion,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST,
  );
  if (containerVersion !== PROJECT_CONTAINER_VERSION) {
    throw ReverieError.from(
      ErrorDefinitions.PROJECT.UNSUPPORTED_PROJECT_VERSION,
      {
        version: containerVersion,
      },
    );
  }
  const documentVersion = requirePositiveInteger(
    input.documentVersion,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST,
  );
  const minimumReaderVersion = requirePositiveInteger(
    input.minimumReaderVersion,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST,
  );
  const requiredFeatures = readFeatureList(input.requiredFeatures);
  return {
    format: PROJECT_FORMAT,
    containerVersion: PROJECT_CONTAINER_VERSION,
    documentVersion,
    minimumReaderVersion,
    ...(requiredFeatures === undefined ? {} : { requiredFeatures }),
  };
}

/** Reconstructs raw payload objects before the existing document parser normalizes them. */
function decodeProjectDocument(
  input: unknown,
  payloadEntries: ReadonlyMap<string, Uint8Array>,
  options: DocumentReadOptions,
): DecodedProjectDocument {
  const envelope = requirePlainRecord(
    input,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const world = requirePlainRecord(
    envelope.world,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const rawLayers = requireArray(
    world.layers,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const referencedPayloads = new Set<string>();
  const layers = rawLayers.map((inputLayer) =>
    decodeProjectLayer(inputLayer, payloadEntries, referencedPayloads),
  );
  const document = parseDocument(
    {
      id: envelope.id,
      format: envelope.format,
      version: envelope.version,
      minimumReaderVersion: envelope.minimumReaderVersion,
      ...(Object.hasOwn(envelope, "requiredFeatures")
        ? { requiredFeatures: envelope.requiredFeatures }
        : {}),
      world: {
        tileSize: world.tileSize,
        bounds: world.bounds,
        layers,
      },
    },
    options,
  );
  return { document, referencedPayloads };
}

/** Reconstructs one Layer's metadata and its binary Tile payloads. */
function decodeProjectLayer(
  input: unknown,
  payloadEntries: ReadonlyMap<string, Uint8Array>,
  referencedPayloads: Set<string>,
): Record<string, unknown> {
  const layer = requirePlainRecord(
    input,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const layerId = requireString(
    layer.id,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const raster = requirePlainRecord(
    layer.raster,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const rawTiles = requireArray(
    raster.tiles,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  return {
    id: layerId,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    raster: {
      tileSize: raster.tileSize,
      pixelFormat: raster.pixelFormat,
      tiles: rawTiles.map((tile) =>
        decodeProjectTile(tile, layerId, payloadEntries, referencedPayloads),
      ),
    },
  };
}

/** Resolves one metadata payload reference into raw bytes and verifies its address. */
function decodeProjectTile(
  input: unknown,
  layerId: string,
  payloadEntries: ReadonlyMap<string, Uint8Array>,
  referencedPayloads: Set<string>,
): Record<string, unknown> {
  const tile = requirePlainRecord(
    input,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const payload = requirePlainRecord(
    tile.payload,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const x = requireSafeInteger(
    tile.x,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const y = requireSafeInteger(
    tile.y,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  const entry = requireString(
    payload.entry,
    ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD,
  );
  if (entry !== createProjectPayloadName(layerId, x, y)) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD);
  }
  const data = payloadEntries.get(entry);
  if (data === undefined) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.MISSING_PROJECT_PAYLOAD, {
      entry,
    });
  }
  referencedPayloads.add(entry);
  return {
    x,
    y,
    payload: { encoding: payload.encoding, data },
  };
}

/** Ensures manifest compatibility claims cannot disagree with document metadata. */
function assertManifestMatchesDocument(
  manifest: ProjectManifestV1,
  document: ReverieDocumentV1,
): void {
  if (
    manifest.documentVersion !== document.version ||
    manifest.minimumReaderVersion !== document.minimumReaderVersion ||
    !hasSameFeatures(manifest.requiredFeatures, document.requiredFeatures)
  ) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST);
  }
}

/** Rejects orphan Raster payload entries that cannot affect restored document state. */
function assertAllPayloadsAreReferenced(
  entries: ReadonlyMap<string, Uint8Array>,
  referencedPayloads: ReadonlySet<string>,
): void {
  for (const name of entries.keys()) {
    if (
      name.startsWith(PROJECT_RASTER_ENTRY_PREFIX) &&
      !referencedPayloads.has(name)
    ) {
      throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD);
    }
  }
}

/** Checks optional feature lists without accepting non-string feature descriptors. */
function readFeatureList(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((feature) => typeof feature !== "string")
  ) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_MANIFEST);
  }
  return [...value];
}

/** Tests ordered feature compatibility because document feature ordering is stable metadata. */
function hasSameFeatures(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): boolean {
  if (first === undefined || second === undefined) {
    return (first ?? []).length === (second ?? []).length;
  }
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

/** Narrows untrusted JSON values to ordinary object records. */
function requirePlainRecord(
  value: unknown,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throwProjectInputError(definition);
  }
  return value;
}

/** Narrows untrusted JSON values to arrays. */
function requireArray(
  value: unknown,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throwProjectInputError(definition);
  }
  return value;
}

/** Reads a string field needed to locate a project payload. */
function requireString(
  value: unknown,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): string {
  if (typeof value !== "string") {
    throwProjectInputError(definition);
  }
  return value;
}

/** Reads a safe integer without allowing coordinate arithmetic to overflow. */
function requireSafeInteger(
  value: unknown,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throwProjectInputError(definition);
  }
  return value;
}

/** Reads a positive safe integer from manifest compatibility metadata. */
function requirePositiveInteger(
  value: unknown,
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): number {
  const result = requireSafeInteger(value, definition);
  if (result < 1) {
    throwProjectInputError(definition);
  }
  return result;
}

/** Converts project-input validation definitions into stable caller-facing errors. */
function throwProjectInputError(
  definition: (typeof ErrorDefinitions.PROJECT)[
    | "INVALID_PROJECT_FORMAT"
    | "INVALID_PROJECT_MANIFEST"
    | "INVALID_PROJECT_PAYLOAD"],
): never {
  throw ReverieError.from(definition);
}
