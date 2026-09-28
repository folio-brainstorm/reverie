import { afterEach, describe, expect, it, vi } from "vitest";

import { World } from "@reveriejs/core";
import { exportProject } from "@reveriejs/core/project";

import {
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME_TYPE,
  WebErrorDefinitions,
  createProjectBlob,
  downloadProject,
  importProjectBlob,
  resolveProjectDownloadFilename,
} from "../index.js";
import { resolveDownloadFilename } from "../src/export/ResolveDownloadFilename.js";
import {
  DownloadTestRuntime,
  flushScheduledTimers,
} from "./DownloadTestRuntime.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Project file integration", () => {
  it("creates a typed Blob containing byte-identical Core project data", async () => {
    const world = createProjectWorld();
    const blob = createProjectBlob(world);

    expect(blob.type).toBe(PROJECT_MIME_TYPE);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      exportProject(world),
    );
  });

  it.each([
    [undefined, "Untitled.reverie"],
    ["Painting", "Painting.reverie"],
    ["Painting.reverie", "Painting.reverie"],
    ["Painting.png", "Painting.png"],
  ])("resolves %s as %s", (filename, expected) => {
    expect(resolveProjectDownloadFilename(filename)).toBe(expected);
  });

  it("validates the default base name only when it is used", () => {
    expect(resolveDownloadFilename("Painting", "reverie", "")).toBe(
      "Painting.reverie",
    );
    expect(() => resolveDownloadFilename(undefined, "reverie", "")).toThrow(
      `[${WebErrorDefinitions.INVALID_DOWNLOAD_BASE_NAME.code}]`,
    );
  });

  it("downloads a project with a cleaned-up object URL and supplied preview", async () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();
    const world = createProjectWorld();

    downloadProject(world, {
      filename: "Concept",
      preview: { mimeType: "image/webp", data: new Uint8Array([9, 8, 7]) },
    });
    await flushScheduledTimers();

    expect(runtime.blobs[0]?.type).toBe(PROJECT_MIME_TYPE);
    expect(runtime.anchors[0]?.download).toBe(
      `Concept.${PROJECT_FILE_EXTENSION}`,
    );
    expect(runtime.anchors[0]?.hasClicked).toBe(true);
    expect(runtime.anchors[0]?.isRemoved).toBe(true);
    expect(runtime.revokedObjectUrls).toEqual(runtime.createdObjectUrls);
  });

  it("does not create browser download resources when Core rejects an empty World", () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    expect(() => downloadProject(new World({ tileSize: 2 }))).toThrow(
      "[EC_PROJECT_0008]",
    );
    expect(runtime.createdObjectUrls).toEqual([]);
    expect(runtime.anchors).toEqual([]);
  });

  it("imports valid Blob content as a new independent World", async () => {
    const source = createProjectWorld();
    const blob = createProjectBlob(source);

    const imported = await importProjectBlob(blob);
    source.getLayer(0).raster.setPixel(
      { x: -1, y: -1 },
      {
        r: 255,
        g: 0,
        b: 0,
        a: 255,
      },
    );

    expect(imported).not.toBe(source);
    expect(imported.getLayer(0).raster.getPixel({ x: -1, y: -1 })).toEqual({
      r: 12,
      g: 24,
      b: 36,
      a: 0,
    });
  });

  it("preserves Core project errors while importing Blob content", async () => {
    await expect(
      importProjectBlob(new Blob([new Uint8Array([1, 2, 3, 4])])),
    ).rejects.toThrow("[EC_PROJECT_0001]");
  });

  it("keeps browser integration separate from image export helpers", () => {
    expect(PROJECT_FILE_EXTENSION).toBe("reverie");
    expect(PROJECT_MIME_TYPE).toBe("application/x-reverie-project");
  });
});

function createProjectWorld(): World {
  const world = new World({
    id: "web-project",
    tileSize: 2,
    bounds: { x: -4, y: -4, width: 8, height: 8 },
  });
  const layer = world.getLayer(0);
  layer.raster.setPixel({ x: -1, y: -1 }, { r: 12, g: 24, b: 36, a: 0 });
  return world;
}
