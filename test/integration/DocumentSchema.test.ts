import { describe, expect, it } from "vitest";

import { Raster, RasterLayer, ReverieError, World } from "@reveriejs/core";
import {
  CURRENT_DOCUMENT_VERSION,
  DOCUMENT_COMPATIBILITY,
  DOCUMENT_FORMAT,
  MINIMUM_READER_VERSION,
  MINIMUM_SUPPORTED_DOCUMENT_VERSION,
  V1_DOCUMENT_VERSION,
  migrateDocument,
  parseDocument,
  serializeDocument,
} from "@reveriejs/core/document";
import type {
  DocumentMigration,
  DocumentSchemaValidator,
  ReverieDocumentV1,
} from "@reveriejs/core/document";

describe("Versioned document schema", () => {
  it("serializes bounded World metadata with negative bounds, stable IDs, and layer order", () => {
    const world = new World({
      id: "document-sketch",
      tileSize: 64,
      bounds: { x: -40, y: -20, width: 120, height: 80 },
    });
    const background = world.getLayer(0);
    background.name = "Background";
    const ink = world.addLayer();
    ink.name = "Ink";
    ink.visible = false;
    ink.opacity = 0.4;
    ink.blendMode = "multiply";

    const serialized = serializeDocument(world);

    expect(serialized).toEqual({
      id: "document-sketch",
      format: DOCUMENT_FORMAT,
      version: CURRENT_DOCUMENT_VERSION,
      minimumReaderVersion: MINIMUM_READER_VERSION,
      world: {
        tileSize: 64,
        bounds: { x: -40, y: -20, width: 120, height: 80 },
        layers: [
          {
            id: background.id,
            name: "Background",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            raster: { tileSize: 64, pixelFormat: "rgba8", tiles: [] },
          },
          {
            id: ink.id,
            name: "Ink",
            visible: false,
            opacity: 0.4,
            blendMode: "multiply",
            raster: { tileSize: 64, pixelFormat: "rgba8", tiles: [] },
          },
        ],
      },
    });
  });

  it("preserves unbounded World metadata as null and produces deterministic output", () => {
    const world = new World({ id: "document-unbounded", tileSize: 32 });

    expect(serializeDocument(world).world.bounds).toBeNull();
    expect(serializeDocument(world)).toEqual(serializeDocument(world));
  });

  it("accepts valid current envelopes and ignores unknown optional fields", () => {
    const input: unknown = {
      ...createDocumentFixture(),
      futureEnvelopeField: { ignored: true },
      world: {
        ...createDocumentFixture().world,
        futureWorldField: 123,
        layers: [
          {
            ...createDocumentFixture().world.layers[0],
            futureLayerField: "ignored",
          },
        ],
      },
    };

    expect(parseDocument(input)).toEqual(createDocumentFixture());
  });

  it("accepts required features only when the reader declares support", () => {
    const document = {
      ...createDocumentFixture(),
      requiredFeatures: ["layer-mask-v1"],
    };

    expect(() => parseDocument(document)).toThrow("[EC_DOCUMENT_0004]");
    expect(
      parseDocument(document, { supportedFeatures: ["layer-mask-v1"] }),
    ).toMatchObject({ requiredFeatures: ["layer-mask-v1"] });
  });

  it.each([
    ["different format", { ...createDocumentFixture(), format: "other" }],
    [
      "newer schema version",
      { ...createDocumentFixture(), version: CURRENT_DOCUMENT_VERSION + 1 },
    ],
    [
      "newer minimum reader version",
      {
        ...createDocumentFixture(),
        minimumReaderVersion: MINIMUM_READER_VERSION + 1,
      },
    ],
  ])("rejects $0", (_scenario, document) => {
    expect(() => parseDocument(document)).toThrow(ReverieError);
  });

  it("distinguishes an unsupported reader requirement from document-version incompatibility", () => {
    const document = {
      ...createDocumentFixture(),
      minimumReaderVersion: MINIMUM_READER_VERSION + 1,
    };

    expect(() => parseDocument(document)).toThrow("[EC_DOCUMENT_0016]");
  });

  it("rejects malformed World and Layer semantics with stable document errors", () => {
    const unsupportedBlendMode = {
      ...createDocumentFixture(),
      world: {
        ...createDocumentFixture().world,
        layers: [
          { ...createDocumentFixture().world.layers[0], blendMode: "future" },
        ],
      },
    };
    const emptyLayers = {
      ...createDocumentFixture(),
      world: { ...createDocumentFixture().world, layers: [] },
    };
    const invalidBounds = {
      ...createDocumentFixture(),
      world: {
        ...createDocumentFixture().world,
        bounds: { x: 0, y: 0, width: 0, height: 1 },
      },
    };

    for (const document of [unsupportedBlendMode, emptyLayers, invalidBounds]) {
      expect(() => parseDocument(document)).toThrow("[EC_DOCUMENT_0002]");
    }
  });

  it("rejects duplicate Layer identities in serialized and runtime documents", () => {
    const duplicateDocument = {
      ...createDocumentFixture(),
      world: {
        ...createDocumentFixture().world,
        layers: [
          createDocumentFixture().world.layers[0],
          { ...createDocumentFixture().world.layers[0], name: "Copy" },
        ],
      },
    };
    expect(() => parseDocument(duplicateDocument)).toThrow(
      "[EC_DOCUMENT_0006]",
    );

    const world = new World({ tileSize: 4 });
    const first = new RasterLayer(
      new Raster({ tileSize: 4 }),
      null,
      "layer-duplicate",
    );
    const second = new RasterLayer(
      new Raster({ tileSize: 4 }),
      null,
      "layer-duplicate",
    );
    world.addLayer(first);
    expect(() => world.addLayer(second)).toThrow("[EC_DOCUMENT_0006]");
  });

  it("keeps parsed schema objects separate from mutable runtime objects", () => {
    const world = new World({
      id: "document-separation",
      tileSize: 8,
      bounds: { x: 0, y: 0, width: 8, height: 8 },
    });
    const layer = world.getLayer(0);
    layer.name = "Runtime name";
    const serialized = serializeDocument(world);
    const parsed = parseDocument(serialized);

    expect(parsed.world.layers[0]).not.toBe(layer);
    expect(parsed.world.bounds).not.toBe(world.bounds);
    expect(layer.name).toBe("Runtime name");
  });
});

describe("Document migration foundation", () => {
  const identityValidator: DocumentSchemaValidator = {
    version: 1,
    validate(input): unknown {
      return input;
    },
  };

  it("declares current writer and minimum supported schema versions explicitly", () => {
    expect(DOCUMENT_COMPATIBILITY).toEqual({
      currentVersion: V1_DOCUMENT_VERSION,
      minimumSupportedVersion: MINIMUM_SUPPORTED_DOCUMENT_VERSION,
      writerVersion: CURRENT_DOCUMENT_VERSION,
    });
  });

  it("does not clone serialized data when no migration step is required", () => {
    const source = { version: 1, nested: { name: "Original" } };

    const migrated = migrateDocument(source, 1, 1, [], [identityValidator]);

    expect(migrated).toEqual(source);
    expect(migrated).toBe(source);
  });

  it("runs validated deterministic adjacent migrations for a synthetic legacy fixture", () => {
    const events: string[] = [];
    const migrations: readonly DocumentMigration[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate(input): unknown {
          events.push("migrate-1-2");
          return { ...requireTestRecord(input), version: 2 };
        },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        migrate(input): unknown {
          events.push("migrate-2-3");
          return { ...requireTestRecord(input), version: 3 };
        },
      },
    ];
    const validators: readonly DocumentSchemaValidator[] = [
      createSyntheticValidator(1, events),
      createSyntheticValidator(2, events),
      createSyntheticValidator(3, events),
    ];
    const source = {
      version: 1,
      legacyName: "Ink",
      raster: { payload: { data: new Uint8Array([255, 0, 0, 0]) } },
    };

    const first = migrateDocument(source, 1, 3, migrations, validators);
    expect(events).toEqual([
      "validate-1",
      "migrate-1-2",
      "validate-2",
      "migrate-2-3",
      "validate-3",
    ]);
    events.length = 0;
    const second = migrateDocument(source, 1, 3, migrations, validators);
    const firstPayload = readTestPayload(first);

    expect(first).toEqual(second);
    expect(requireTestRecord(first).version).toBe(3);
    expect(firstPayload).toEqual(new Uint8Array([255, 0, 0, 0]));
    expect(firstPayload).not.toBe(source.raster.payload.data);
    expect(source).toEqual({
      version: 1,
      legacyName: "Ink",
      raster: { payload: { data: new Uint8Array([255, 0, 0, 0]) } },
    });
  });

  it("rejects malformed sources before migration logic can access them", () => {
    let didRunMigration = false;
    const sourceValidator: DocumentSchemaValidator = {
      version: 1,
      validate(input): unknown {
        if (requireTestRecord(input).version !== 1) {
          throw new ReverieError(
            "EC_DOCUMENT_0002",
            "Synthetic source version is invalid.",
          );
        }
        return input;
      },
    };
    const migration: DocumentMigration = {
      fromVersion: 1,
      toVersion: 2,
      migrate(input): unknown {
        didRunMigration = true;
        return { ...requireTestRecord(input), version: 2 };
      },
    };

    expect(() =>
      migrateDocument(
        { version: "invalid" },
        1,
        2,
        [migration],
        [sourceValidator, createSyntheticValidator(2)],
      ),
    ).toThrow("[EC_DOCUMENT_0002]");
    expect(didRunMigration).toBe(false);
  });

  it("wraps invalid target output, missing paths, and thrown transitions as migration failures", () => {
    expect(() => migrateDocument({}, 1, 2, [], [identityValidator])).toThrow(
      "[EC_DOCUMENT_0005]",
    );
    expect(() =>
      migrateDocument(
        { version: 1 },
        1,
        2,
        [
          {
            fromVersion: 1,
            toVersion: 2,
            migrate(): unknown {
              throw new Error("legacy migration failed");
            },
          },
        ],
        [identityValidator, createSyntheticValidator(2)],
      ),
    ).toThrow("[EC_DOCUMENT_0005]");
    let migrationError: unknown;
    try {
      migrateDocument(
        { version: 1 },
        1,
        2,
        [
          {
            fromVersion: 1,
            toVersion: 2,
            migrate(): unknown {
              return { version: "invalid" };
            },
          },
        ],
        [identityValidator, createSyntheticValidator(2)],
      );
    } catch (error) {
      migrationError = error;
    }
    expect(migrationError).toBeInstanceOf(ReverieError);
    if (!(migrationError instanceof ReverieError)) {
      throw new Error("Invalid target schema must produce a ReverieError.");
    }
    expect(migrationError.code).toBe("EC_DOCUMENT_0005");
    expect(migrationError.cause).toBeInstanceOf(Error);
  });
});

function createSyntheticValidator(
  version: number,
  events?: string[],
): DocumentSchemaValidator {
  return {
    version,
    validate(input): unknown {
      events?.push(`validate-${version}`);
      if (requireTestRecord(input).version !== version) {
        throw new Error(`Expected synthetic schema version ${version}.`);
      }
      return input;
    },
  };
}

function requireTestRecord(input: unknown): Record<string, unknown> {
  if (!isTestRecord(input)) {
    throw new Error("Synthetic document must be a record.");
  }
  return input;
}

function isTestRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readTestPayload(input: unknown): Uint8Array {
  const raster = requireTestRecord(requireTestRecord(input).raster);
  const payload = requireTestRecord(raster.payload);
  if (!(payload.data instanceof Uint8Array)) {
    throw new Error("Synthetic document must retain a Uint8Array payload.");
  }
  return payload.data;
}

function createDocumentFixture(): ReverieDocumentV1 {
  return {
    id: "document-fixture",
    format: DOCUMENT_FORMAT,
    version: CURRENT_DOCUMENT_VERSION,
    minimumReaderVersion: MINIMUM_READER_VERSION,
    world: {
      tileSize: 16,
      bounds: { x: -2, y: 3, width: 20, height: 10 },
      layers: [
        {
          id: "layer-fixture",
          name: "Fixture",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          raster: { tileSize: 16, pixelFormat: "rgba8", tiles: [] },
        },
      ],
    },
  };
}
