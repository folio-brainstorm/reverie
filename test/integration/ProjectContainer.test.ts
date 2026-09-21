import { describe, expect, it } from "vitest";

import { ReverieError } from "@reverie/core";
import type { ReverieDocumentV1 } from "@reverie/core/document";
import {
  decodeProjectContainer,
  encodeProjectContainer,
  PROJECT_CONTAINER_VERSION,
  PROJECT_FORMAT,
} from "@reverie/core/project";

describe("Project container", () => {
  it("round-trips deterministic sparse Raster bytes including negative coordinates and transparent RGB", () => {
    const source = createDocumentFixture();

    const first = encodeProjectContainer(source);
    const second = encodeProjectContainer(source);
    const decoded = decodeProjectContainer(first);

    expect(first).toEqual(second);
    expect(decoded).toEqual(source);
    expect(decoded.world.layers[0]?.raster.tiles[0]?.payload.data).toEqual(
      new Uint8Array([11, 22, 33, 0]),
    );
  });

  it("captures a document snapshot rather than retaining mutable Raster payload references", () => {
    const source = createDocumentFixture();
    const bytes = encodeProjectContainer(source);
    const sourcePayload = source.world.layers[0]?.raster.tiles[0]?.payload.data;
    if (sourcePayload === undefined) {
      throw new Error("Fixture must contain one Raster payload.");
    }
    sourcePayload[0] = 255;

    expect(
      decodeProjectContainer(bytes).world.layers[0]?.raster.tiles[0]?.payload
        .data[0],
    ).toBe(11);
  });

  it("rejects an empty document before writing a project", () => {
    const source = createDocumentFixture();
    const empty: ReverieDocumentV1 = {
      ...source,
      world: {
        ...source.world,
        layers: [
          {
            ...source.world.layers[0]!,
            raster: { ...source.world.layers[0]!.raster, tiles: [] },
          },
        ],
      },
    };

    expect(() => encodeProjectContainer(empty)).toThrow("[EC_PROJECT_0008]");
  });

  it("rejects a container whose document references no Raster payloads", () => {
    const source = createDocumentFixture();
    const empty: ReverieDocumentV1 = {
      ...source,
      world: {
        ...source.world,
        layers: [
          {
            ...source.world.layers[0]!,
            raster: { ...source.world.layers[0]!.raster, tiles: [] },
          },
        ],
      },
    };
    const container = createContainer([
      ["manifest.json", encodeJson(createManifest())],
      ["document.json", encodeJson(empty)],
    ]);

    expect(() => decodeProjectContainer(container)).toThrow(
      "[EC_PROJECT_0008]",
    );
  });

  it("preserves declared features while requiring reader support to decode them", () => {
    const source: ReverieDocumentV1 = {
      ...createDocumentFixture(),
      requiredFeatures: ["feature-alpha"],
    };
    const bytes = encodeProjectContainer(source);

    expect(() => decodeProjectContainer(bytes)).toThrow("[EC_DOCUMENT_0004]");
    expect(
      decodeProjectContainer(bytes, {
        supportedFeatures: ["feature-alpha"],
      }),
    ).toEqual(source);
  });

  it("rejects invalid headers, unsupported versions, missing documents, and duplicate entries", () => {
    expect(() => decodeProjectContainer(new Uint8Array([1, 2, 3, 4]))).toThrow(
      "[EC_PROJECT_0001]",
    );

    const newerManifest = createManifest({ containerVersion: 2 });
    expect(() =>
      decodeProjectContainer(
        createContainer([["manifest.json", encodeJson(newerManifest)]]),
      ),
    ).toThrow("[EC_PROJECT_0002]");

    expect(() =>
      decodeProjectContainer(
        createContainer([["manifest.json", encodeJson(createManifest())]]),
      ),
    ).toThrow("[EC_PROJECT_0004]");

    expect(() =>
      decodeProjectContainer(
        createContainer([
          ["manifest.json", encodeJson(createManifest())],
          ["manifest.json", encodeJson(createManifest())],
        ]),
      ),
    ).toThrow("[EC_PROJECT_0005]");
  });

  it("rejects missing or unreferenced Raster payload entries atomically", () => {
    const source = createDocumentFixture();
    const bytes = encodeProjectContainer(source);
    const entries = readEntries(bytes);
    const withoutPayload = new Map(entries);
    withoutPayload.delete(
      "raster/006c0061007900650072002d00700072006f006a006500630074/x=-1_y=2.bin",
    );

    expect(() =>
      decodeProjectContainer(createContainer([...withoutPayload])),
    ).toThrow("[EC_PROJECT_0006]");

    const withOrphan = new Map(entries);
    withOrphan.set(
      "raster/006c0061007900650072002d00700072006f006a006500630074/x=8_y=9.bin",
      new Uint8Array([1]),
    );
    expect(() =>
      decodeProjectContainer(createContainer([...withOrphan])),
    ).toThrow("[EC_PROJECT_0007]");
  });

  it("accepts a reserved optional preview without making it document content", () => {
    const entries = readEntries(
      encodeProjectContainer(createDocumentFixture()),
    );
    entries.set("preview/thumbnail.webp", new Uint8Array([1, 2, 3]));

    expect(decodeProjectContainer(createContainer([...entries]))).toEqual(
      createDocumentFixture(),
    );
  });

  it.each(["preview/.", "preview/.."])(
    "rejects a traversal-significant preview entry name: %s",
    (previewName) => {
      const entries = readEntries(
        encodeProjectContainer(createDocumentFixture()),
      );
      entries.set(previewName, new Uint8Array([1]));

      expect(() =>
        decodeProjectContainer(createContainer([...entries])),
      ).toThrow("[EC_PROJECT_0007]");
    },
  );

  it("retains stable project errors rather than leaking native JSON errors", () => {
    const malformedManifest = new TextEncoder().encode("{");

    expect(() =>
      decodeProjectContainer(
        createContainer([["manifest.json", malformedManifest]]),
      ),
    ).toThrow(ReverieError);
    expect(() =>
      decodeProjectContainer(
        createContainer([["manifest.json", malformedManifest]]),
      ),
    ).toThrow("[EC_PROJECT_0003]");
  });
});

function createDocumentFixture(): ReverieDocumentV1 {
  return {
    id: "project-fixture",
    format: "reverie-document",
    version: 1,
    minimumReaderVersion: 1,
    world: {
      tileSize: 1,
      bounds: { x: -2, y: -3, width: 8, height: 8 },
      layers: [
        {
          id: "layer-project",
          name: "Project Layer",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          raster: {
            tileSize: 1,
            pixelFormat: "rgba8",
            tiles: [
              {
                x: -1,
                y: 2,
                payload: {
                  encoding: "rgba8-raw",
                  data: new Uint8Array([11, 22, 33, 0]),
                },
              },
              {
                x: 3,
                y: 4,
                payload: {
                  encoding: "rgba8-raw",
                  data: new Uint8Array([40, 50, 60, 255]),
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function createManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: PROJECT_FORMAT,
    containerVersion: PROJECT_CONTAINER_VERSION,
    documentVersion: 1,
    minimumReaderVersion: 1,
    ...overrides,
  };
}

function createContainer(
  entries: readonly (readonly [string, Uint8Array])[],
): Uint8Array {
  const encoder = new TextEncoder();
  const magic = encoder.encode("RVRP");
  const encodedEntries = entries.map(
    ([name, data]) => [encoder.encode(name), data] as const,
  );
  const length = encodedEntries.reduce(
    (total, [name, data]) => total + 8 + name.byteLength + data.byteLength,
    8,
  );
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  output.set(magic);
  view.setUint32(4, entries.length, true);
  let offset = 8;
  for (const [name, data] of encodedEntries) {
    view.setUint32(offset, name.byteLength, true);
    offset += 4;
    output.set(name, offset);
    offset += name.byteLength;
    view.setUint32(offset, data.byteLength, true);
    offset += 4;
    output.set(data, offset);
    offset += data.byteLength;
  }
  return output;
}

function encodeJson(value: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  const count = view.getUint32(4, true);
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint32(offset, true);
    offset += 4;
    const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    entries.set(name, bytes.slice(offset, offset + dataLength));
    offset += dataLength;
  }
  return entries;
}
