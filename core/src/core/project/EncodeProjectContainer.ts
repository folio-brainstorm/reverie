import type { ReverieDocumentV1 } from "../../interfaces/document/ReverieDocumentV1.js";
import type { ProjectContainerEntry } from "../../interfaces/project/ProjectContainerEntry.js";
import type { ProjectContainerOptions } from "../../interfaces/project/ProjectContainerOptions.js";
import type { ProjectDocumentV1 } from "../../interfaces/project/ProjectDocumentV1.js";
import type { ProjectManifestV1 } from "../../interfaces/project/ProjectManifestV1.js";
import type { ProjectPreview } from "../../interfaces/project/ProjectPreview.js";

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
} from "../../config/project/ProjectContainer.js";
import { parseDocument } from "../document/ParseDocument.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieError } from "../../utils/errors/ReverieErrors.js";
import { isPlainRecord } from "../../utils/object/IsPlainRecord.js";
import { createProjectPayloadName } from "./CreateProjectPayloadName.js";
import { createProjectPreviewName } from "./CreateProjectPreviewName.js";

const textEncoder = new TextEncoder();

/**
 * Encodes a complete serialized-document snapshot as a deterministic `.reverie`
 * multi-entry container. Raw Raster bytes remain independent binary entries.
 *
 * @param document - Step 28 serialized document snapshot to package.
 * @returns Self-contained project-container bytes.
 * @throws {ReverieError} The document is invalid, empty, or exceeds container limits.
 */
export function encodeProjectContainer(
  document: ReverieDocumentV1,
  options: ProjectContainerOptions = {},
): Uint8Array {
  return encodeNormalizedProjectContainer(
    parseDocument(
      document,
      document?.requiredFeatures === undefined
        ? {}
        : { supportedFeatures: document.requiredFeatures },
    ),
    options,
  );
}

/**
 * Encodes a document snapshot that the document pipeline has already normalized.
 *
 * This package-internal integration hook avoids reparsing immutable snapshots
 * created by {@link serializeDocument}. Unknown input must use
 * {@link encodeProjectContainer} instead.
 *
 * @param document - Current V1 document snapshot already normalized and owned by the caller.
 * @param options - Optional non-authoritative physical container data.
 * @returns Self-contained project-container bytes.
 * @throws {ReverieError} The preview, project content, or binary layout is invalid.
 */
export function encodeNormalizedProjectContainer(
  document: ReverieDocumentV1,
  options: ProjectContainerOptions = {},
): Uint8Array {
  const entries = createProjectEntries(document, readProjectPreview(options));
  return writeEntries(entries);
}

/** Produces the required JSON entries and deterministic raw Raster payload entries. */
function createProjectEntries(
  document: ReverieDocumentV1,
  preview: ProjectPreview | undefined,
): readonly ProjectContainerEntry[] {
  const payloadEntries: ProjectContainerEntry[] = [];
  let hasRasterContent = false;
  const projectDocument: ProjectDocumentV1 = {
    id: document.id,
    format: document.format,
    version: document.version,
    minimumReaderVersion: document.minimumReaderVersion,
    ...(document.requiredFeatures === undefined
      ? {}
      : { requiredFeatures: document.requiredFeatures }),
    world: {
      tileSize: document.world.tileSize,
      bounds: document.world.bounds,
      layers: document.world.layers.map((layer) => {
        const tiles = [...layer.raster.tiles].sort(compareTiles);
        return {
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          raster: {
            tileSize: layer.raster.tileSize,
            pixelFormat: layer.raster.pixelFormat,
            tiles: tiles.map((tile) => {
              hasRasterContent = true;
              const entry = createProjectPayloadName(layer.id, tile.x, tile.y);
              payloadEntries.push({ name: entry, data: tile.payload.data });
              return {
                x: tile.x,
                y: tile.y,
                payload: { encoding: tile.payload.encoding, entry },
              };
            }),
          },
        };
      }),
    },
  };
  if (!hasRasterContent) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.EMPTY_PROJECT);
  }

  const manifest: ProjectManifestV1 = {
    format: PROJECT_FORMAT,
    containerVersion: PROJECT_CONTAINER_VERSION,
    documentVersion: document.version,
    minimumReaderVersion: document.minimumReaderVersion,
    ...(document.requiredFeatures === undefined
      ? {}
      : { requiredFeatures: document.requiredFeatures }),
  };
  return [
    { name: PROJECT_MANIFEST_ENTRY, data: encodeJson(manifest) },
    { name: PROJECT_DOCUMENT_ENTRY, data: encodeJson(projectDocument) },
    ...payloadEntries,
    ...(preview === undefined
      ? []
      : [
          {
            name: createProjectPreviewName(preview.mimeType),
            data: preview.data,
          },
        ]),
  ];
}

/** Validates optional host preview input and takes ownership of its byte storage. */
function readProjectPreview(options: unknown): ProjectPreview | undefined {
  if (!isPlainRecord(options)) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PREVIEW);
  }
  const preview = options.preview;
  if (preview === undefined) {
    return undefined;
  }
  if (
    !isPlainRecord(preview) ||
    typeof preview.mimeType !== "string" ||
    !isValidMimeType(preview.mimeType) ||
    !(preview.data instanceof Uint8Array)
  ) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PREVIEW);
  }
  return { mimeType: preview.mimeType, data: new Uint8Array(preview.data) };
}

/** Accepts ordinary media types without parameters or path-significant characters. */
function isValidMimeType(value: string): boolean {
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value);
}

/** Orders Tile coordinates using the schema's stable Y-then-X convention. */
function compareTiles(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return first.y - second.y || first.x - second.x;
}

/** Encodes JSON without ever converting binary Raster payloads to text. */
function encodeJson(value: object): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

/** Writes the compact entry stream after checking all uint32-sized fields. */
function writeEntries(entries: readonly ProjectContainerEntry[]): Uint8Array {
  if (entries.length > PROJECT_CONTAINER_MAX_ENTRY_COUNT) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD);
  }
  let length = PROJECT_CONTAINER_HEADER_BYTES;
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw ReverieError.from(
        ErrorDefinitions.PROJECT.DUPLICATE_PROJECT_ENTRY,
        {
          entry: entry.name,
        },
      );
    }
    names.add(entry.name);
    const encodedName = textEncoder.encode(entry.name);
    assertUint32(encodedName.byteLength);
    assertUint32(entry.data.byteLength);
    length = addLength(
      length,
      PROJECT_CONTAINER_UINT32_BYTES + encodedName.byteLength,
    );
    length = addLength(
      length,
      PROJECT_CONTAINER_UINT32_BYTES + entry.data.byteLength,
    );
  }
  assertUint32(entries.length);

  const output = new Uint8Array(length);
  output.set(textEncoder.encode(PROJECT_CONTAINER_MAGIC));
  const view = new DataView(output.buffer);
  let offset = PROJECT_CONTAINER_MAGIC_BYTES;
  view.setUint32(offset, entries.length, true);
  offset += PROJECT_CONTAINER_UINT32_BYTES;
  for (const entry of entries) {
    const encodedName = textEncoder.encode(entry.name);
    view.setUint32(offset, encodedName.byteLength, true);
    offset += PROJECT_CONTAINER_UINT32_BYTES;
    output.set(encodedName, offset);
    offset += encodedName.byteLength;
    view.setUint32(offset, entry.data.byteLength, true);
    offset += PROJECT_CONTAINER_UINT32_BYTES;
    output.set(entry.data, offset);
    offset += entry.data.byteLength;
  }
  return output;
}

/** Rejects values that cannot be represented by this V1 binary layout. */
function assertUint32(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw ReverieError.from(ErrorDefinitions.PROJECT.INVALID_PROJECT_PAYLOAD);
  }
}

/** Adds entry sizes without accepting a project that overflows uint32 offsets. */
function addLength(current: number, addition: number): number {
  const next = current + addition;
  assertUint32(next);
  return next;
}
