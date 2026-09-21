import { describe, expect, it } from "vitest";

import { Raster, World } from "@reverie/core";
import type { RGBAColor } from "@reverie/core";
import { deserializeDocument, serializeDocument } from "@reverie/core/document";
import {
  getRasterTilePixels,
  getRasterTileVersion,
} from "@reverie/core/renderer";
import type { TileCoord } from "@reverie/core/renderer";

import {
  ExportRenderer,
  ExporterErrorDefinitions,
  ExporterRangeError,
  ExporterTypeError,
} from "../index.js";
import type { ExportResult } from "../index.js";

const RGBA_CHANNEL_COUNT = 4;
const TEST_TILE_SIZE = 4;
const TRANSPARENT_PIXEL = [0, 0, 0, 0];

/** Builds a fresh RGBA8 color so tests never share mutable state. */
function createColor(r: number, g: number, b: number, a: number): RGBAColor {
  return { r, g, b, a };
}

/** Expands a color object into its four ordered RGBA8 channels. */
function toChannels(color: RGBAColor): number[] {
  return [color.r, color.g, color.b, color.a];
}

/** Reads one exported pixel as an ordered channel array. */
function readExportedPixel(
  result: ExportResult,
  x: number,
  y: number,
): number[] {
  const offset = (y * result.width + x) * RGBA_CHANNEL_COUNT;

  return Array.from(result.pixels.slice(offset, offset + RGBA_CHANNEL_COUNT));
}

/**
 * Fills tile `(0, 0)` with a distinct color per pixel.
 *
 * @param raster - Raster receiving the pattern.
 * @param tileSize - Pixels along each tile edge.
 * @returns The tile's RGBA8 bytes in row-major order.
 */
function fillTilePattern(raster: Raster, tileSize: number): number[] {
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      raster.setPixel({ x, y }, createColor(x * 16, y * 16, (x + y) * 8, 255));
    }
  }

  return Array.from(getRasterTilePixels(raster, { x: 0, y: 0 }) ?? []);
}

describe("ExportRenderer construction", () => {
  it("is available through the exporter entry point", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });

    expect(new ExportRenderer({ raster })).toBeInstanceOf(ExportRenderer);
  });

  it("keeps its raster dependency fixed after construction", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const renderer = new ExportRenderer({ raster });

    expect(renderer.raster).toBe(raster);
  });
});

describe("ExportRenderer document round-trip integration", () => {
  it("exports a hydrated World with the same composed pixels", () => {
    const source = new World({ tileSize: 2 });
    source
      .getLayer(0)
      .raster.setPixel({ x: 0, y: 0 }, createColor(100, 50, 25, 255));
    const top = source.addLayer();
    top.raster.setPixel({ x: 0, y: 0 }, createColor(50, 100, 200, 255));
    top.opacity = 0.5;

    const hydrated = deserializeDocument(serializeDocument(source));
    const region = { x: 0, y: 0, width: 2, height: 2 };

    expect(new ExportRenderer({ world: hydrated }).render(region)).toEqual(
      new ExportRenderer({ world: source }).render(region),
    );
  });
});

describe("ExportRenderer region mapping", () => {
  it("exports a fully transparent bitmap for an empty raster", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 16, height: 16 });

    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.pixels.length).toBe(16 * 16 * RGBA_CHANNEL_COUNT);
    expect(result.pixels.every((channel) => channel === 0)).toBe(true);
  });

  it("exports a single requested world pixel", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(255, 0, 0, 255);
    raster.setPixel({ x: 1, y: 1 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 1, y: 1, width: 1, height: 1 });

    expect(result.pixels.length).toBe(RGBA_CHANNEL_COUNT);
    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
  });

  it("maps a region offset inside one tile into export-local coordinates", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(10, 20, 30, 40);
    raster.setPixel({ x: 2, y: 1 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 1, y: 1, width: 2, height: 2 });

    expect(readExportedPixel(result, 1, 0)).toEqual(toChannels(color));
    expect(readExportedPixel(result, 0, 0)).toEqual(TRANSPARENT_PIXEL);
    expect(readExportedPixel(result, 0, 1)).toEqual(TRANSPARENT_PIXEL);
    expect(readExportedPixel(result, 1, 1)).toEqual(TRANSPARENT_PIXEL);
  });

  it("exports a horizontal scanline spanning multiple tiles", () => {
    const raster = new Raster({ tileSize: 8 });
    const left = createColor(1, 2, 3, 255);
    const right = createColor(4, 5, 6, 255);
    raster.setPixel({ x: 0, y: 0 }, left);
    raster.setPixel({ x: 99, y: 0 }, right);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 100, height: 1 });

    expect(result.width).toBe(100);
    expect(result.height).toBe(1);
    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(left));
    expect(readExportedPixel(result, 50, 0)).toEqual(TRANSPARENT_PIXEL);
    expect(readExportedPixel(result, 99, 0)).toEqual(toChannels(right));
  });

  it("exports a vertical scanline spanning multiple tiles", () => {
    const raster = new Raster({ tileSize: 8 });
    const top = createColor(1, 2, 3, 255);
    const bottom = createColor(4, 5, 6, 255);
    raster.setPixel({ x: 0, y: 0 }, top);
    raster.setPixel({ x: 0, y: 99 }, bottom);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 1, height: 100 });

    expect(result.width).toBe(1);
    expect(result.height).toBe(100);
    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(top));
    expect(readExportedPixel(result, 0, 50)).toEqual(TRANSPARENT_PIXEL);
    expect(readExportedPixel(result, 0, 99)).toEqual(toChannels(bottom));
  });
});

describe("ExportRenderer tile coverage", () => {
  it("exports an exact tile in row-major RGBA8 order", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const tilePixels = fillTilePattern(raster, TEST_TILE_SIZE);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({
      x: 0,
      y: 0,
      width: TEST_TILE_SIZE,
      height: TEST_TILE_SIZE,
    });

    expect(Array.from(result.pixels)).toEqual(tilePixels);
  });

  it("exports a sub-rectangle of a single tile", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const tilePixels = fillTilePattern(raster, TEST_TILE_SIZE);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 1, y: 1, width: 2, height: 2 });

    // Tile row stride is `tileSize * 4` bytes; both rows start after one pixel.
    const expected = [...tilePixels.slice(20, 28), ...tilePixels.slice(36, 44)];

    expect(Array.from(result.pixels)).toEqual(expected);
  });

  it("stitches two horizontally adjacent tiles into one scanline", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const leftEdge = createColor(9, 8, 7, 255);
    const rightEdge = createColor(6, 5, 4, 255);
    raster.setPixel({ x: TEST_TILE_SIZE - 1, y: 0 }, leftEdge);
    raster.setPixel({ x: TEST_TILE_SIZE, y: 0 }, rightEdge);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({
      x: 0,
      y: 0,
      width: TEST_TILE_SIZE * 2,
      height: 1,
    });

    expect(readExportedPixel(result, TEST_TILE_SIZE - 1, 0)).toEqual(
      toChannels(leftEdge),
    );
    expect(readExportedPixel(result, TEST_TILE_SIZE, 0)).toEqual(
      toChannels(rightEdge),
    );
  });

  it("stitches two vertically adjacent tiles into one column", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const topEdge = createColor(9, 8, 7, 255);
    const bottomEdge = createColor(6, 5, 4, 255);
    raster.setPixel({ x: 0, y: TEST_TILE_SIZE - 1 }, topEdge);
    raster.setPixel({ x: 0, y: TEST_TILE_SIZE }, bottomEdge);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({
      x: 0,
      y: 0,
      width: 1,
      height: TEST_TILE_SIZE * 2,
    });

    expect(readExportedPixel(result, 0, TEST_TILE_SIZE - 1)).toEqual(
      toChannels(topEdge),
    );
    expect(readExportedPixel(result, 0, TEST_TILE_SIZE)).toEqual(
      toChannels(bottomEdge),
    );
  });

  it("reads the four tiles intersecting a region corner", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const topLeft = createColor(1, 0, 0, 255);
    const topRight = createColor(2, 0, 0, 255);
    const bottomLeft = createColor(3, 0, 0, 255);
    const bottomRight = createColor(4, 0, 0, 255);
    raster.setPixel({ x: 1, y: 1 }, topLeft);
    raster.setPixel({ x: 5, y: 1 }, topRight);
    raster.setPixel({ x: 1, y: 5 }, bottomLeft);
    raster.setPixel({ x: 5, y: 5 }, bottomRight);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 1, y: 1, width: 6, height: 6 });

    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(topLeft));
    expect(readExportedPixel(result, 4, 0)).toEqual(toChannels(topRight));
    expect(readExportedPixel(result, 0, 4)).toEqual(toChannels(bottomLeft));
    expect(readExportedPixel(result, 4, 4)).toEqual(toChannels(bottomRight));
  });

  it("leaves missing tiles transparent without affecting allocated ones", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(11, 22, 33, 255);
    raster.setPixel({ x: 0, y: 0 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({
      x: 0,
      y: 0,
      width: TEST_TILE_SIZE * 2,
      height: 1,
    });

    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
    expect(readExportedPixel(result, TEST_TILE_SIZE, 0)).toEqual(
      TRANSPARENT_PIXEL,
    );
    expect(readExportedPixel(result, TEST_TILE_SIZE * 2 - 1, 0)).toEqual(
      TRANSPARENT_PIXEL,
    );
  });
});

describe("ExportRenderer negative coordinates", () => {
  it("maps negative world pixels through their containing tiles", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const minusOne = createColor(1, 1, 1, 255);
    const tileAligned = createColor(2, 2, 2, 255);
    const farNegative = createColor(3, 3, 3, 255);
    raster.setPixel({ x: -1, y: -1 }, minusOne);
    raster.setPixel({ x: -TEST_TILE_SIZE, y: -TEST_TILE_SIZE }, tileAligned);
    raster.setPixel(
      { x: -TEST_TILE_SIZE - 1, y: -TEST_TILE_SIZE - 1 },
      farNegative,
    );
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({
      x: -TEST_TILE_SIZE - 1,
      y: -TEST_TILE_SIZE - 1,
      width: TEST_TILE_SIZE + 1,
      height: TEST_TILE_SIZE + 1,
    });

    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(farNegative));
    expect(readExportedPixel(result, 1, 1)).toEqual(toChannels(tileAligned));
    expect(readExportedPixel(result, TEST_TILE_SIZE, TEST_TILE_SIZE)).toEqual(
      toChannels(minusOne),
    );
  });

  it.each([-1, -TEST_TILE_SIZE, -TEST_TILE_SIZE - 1])(
    "exports the world pixel at negative x %i",
    (x) => {
      const raster = new Raster({ tileSize: TEST_TILE_SIZE });
      const color = createColor(12, 34, 56, 78);
      raster.setPixel({ x, y: 0 }, color);
      const renderer = new ExportRenderer({ raster });

      const result = renderer.render({ x, y: 0, width: 1, height: 1 });

      expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
    },
  );

  it.each([TEST_TILE_SIZE - 1, TEST_TILE_SIZE, TEST_TILE_SIZE + 1])(
    "exports the world pixel at positive tile boundary x %i",
    (x) => {
      const raster = new Raster({ tileSize: TEST_TILE_SIZE });
      const color = createColor(12, 34, 56, 78);
      raster.setPixel({ x, y: 0 }, color);
      const renderer = new ExportRenderer({ raster });

      const result = renderer.render({ x, y: 0, width: 1, height: 1 });

      expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
    },
  );
});

describe("ExportRenderer alpha semantics", () => {
  it("preserves the RGB channels of a fully transparent pixel", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(200, 150, 100, 0);
    raster.setPixel({ x: 0, y: 0 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 1, height: 1 });

    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
  });

  it("copies straight alpha without premultiplying channels", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(255, 128, 64, 128);
    raster.setPixel({ x: 0, y: 0 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 1, height: 1 });

    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(color));
  });
});

describe("ExportRenderer isolation", () => {
  it("returns a buffer independent from the raster and later exports", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const color = createColor(1, 2, 3, 255);
    raster.setPixel({ x: 0, y: 0 }, color);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 1, height: 1 });
    result.pixels.fill(255);

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(color);

    const repeated = renderer.render({ x: 0, y: 0, width: 1, height: 1 });

    expect(readExportedPixel(repeated, 0, 0)).toEqual(toChannels(color));
  });

  it("does not change tile versions or pixels while exporting", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    fillTilePattern(raster, TEST_TILE_SIZE);
    const coord: TileCoord = { x: 0, y: 0 };
    const versionBefore = getRasterTileVersion(raster, coord);
    const pixelsBefore = Array.from(getRasterTilePixels(raster, coord) ?? []);
    const renderer = new ExportRenderer({ raster });

    renderer.render({
      x: 0,
      y: 0,
      width: TEST_TILE_SIZE,
      height: TEST_TILE_SIZE,
    });

    expect(getRasterTileVersion(raster, coord)).toEqual(versionBefore);
    expect(Array.from(getRasterTilePixels(raster, coord) ?? [])).toEqual(
      pixelsBefore,
    );
  });

  it("produces byte-identical buffers across repeated renders", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    fillTilePattern(raster, TEST_TILE_SIZE);
    const renderer = new ExportRenderer({ raster });
    const region = {
      x: 0,
      y: 0,
      width: TEST_TILE_SIZE,
      height: TEST_TILE_SIZE,
    };

    const first = renderer.render(region);
    const second = renderer.render(region);

    expect(first.pixels).not.toBe(second.pixels);
    expect(Array.from(first.pixels)).toEqual(Array.from(second.pixels));
  });
});

describe("ExportRenderer validation", () => {
  it("exposes stable machine-readable error codes", () => {
    expect(ExporterErrorDefinitions.INVALID_REGION_FIELD_TYPE.code).toBe(
      "EC_EXPORTER_0001",
    );
    expect(ExporterErrorDefinitions.INVALID_REGION_COORDINATE.code).toBe(
      "EC_EXPORTER_0002",
    );
    expect(ExporterErrorDefinitions.INVALID_REGION_SIZE.code).toBe(
      "EC_EXPORTER_0003",
    );
    expect(ExporterErrorDefinitions.REGION_EXCEEDS_SAFE_RANGE.code).toBe(
      "EC_EXPORTER_0004",
    );
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects the invalid region coordinate x=%s", (x) => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: TEST_TILE_SIZE }),
    });
    const renderRegion = () =>
      renderer.render({ x, y: 0, width: 1, height: 1 });

    expect(renderRegion).toThrow(ExporterRangeError);
    expect(renderRegion).toThrow(
      `[${ExporterErrorDefinitions.INVALID_REGION_COORDINATE.code}]`,
    );
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects the invalid region coordinate y=%s", (y) => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: TEST_TILE_SIZE }),
    });
    const renderRegion = () =>
      renderer.render({ x: 0, y, width: 1, height: 1 });

    expect(renderRegion).toThrow(ExporterRangeError);
    expect(renderRegion).toThrow(
      `[${ExporterErrorDefinitions.INVALID_REGION_COORDINATE.code}]`,
    );
  });

  it("rejects a non-number coordinate as a type failure", () => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: TEST_TILE_SIZE }),
    });
    const renderRegion = () =>
      renderer.render({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        x: "0",
        y: 0,
        width: 1,
        height: 1,
      });

    expect(renderRegion).toThrow(ExporterTypeError);
    expect(renderRegion).toThrow(
      `[${ExporterErrorDefinitions.INVALID_REGION_FIELD_TYPE.code}]`,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid region extent width=%s",
    (width) => {
      const renderer = new ExportRenderer({
        raster: new Raster({ tileSize: TEST_TILE_SIZE }),
      });
      const renderRegion = () =>
        renderer.render({ x: 0, y: 0, width, height: 1 });

      expect(renderRegion).toThrow(ExporterRangeError);
      expect(renderRegion).toThrow(
        `[${ExporterErrorDefinitions.INVALID_REGION_SIZE.code}]`,
      );
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid region extent height=%s",
    (height) => {
      const renderer = new ExportRenderer({
        raster: new Raster({ tileSize: TEST_TILE_SIZE }),
      });
      const renderRegion = () =>
        renderer.render({ x: 0, y: 0, width: 1, height });

      expect(renderRegion).toThrow(ExporterRangeError);
      expect(renderRegion).toThrow(
        `[${ExporterErrorDefinitions.INVALID_REGION_SIZE.code}]`,
      );
    },
  );

  it("rejects a non-number extent as a size failure", () => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: TEST_TILE_SIZE }),
    });
    const renderRegion = () =>
      renderer.render({
        x: 0,
        y: 0,
        // @ts-expect-error Runtime validation protects JavaScript callers.
        width: "4",
        height: 1,
      });

    expect(renderRegion).toThrow(ExporterRangeError);
    expect(renderRegion).toThrow(
      `[${ExporterErrorDefinitions.INVALID_REGION_SIZE.code}]`,
    );
  });

  it.each([
    { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 1 },
    { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 2 },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 2, height: 1 },
    { x: 0, y: Number.MAX_SAFE_INTEGER, width: 1, height: 2 },
    {
      x: Number.MAX_SAFE_INTEGER,
      y: Number.MAX_SAFE_INTEGER,
      width: 2,
      height: 2,
    },
  ])("rejects the unsafe region %#", (region) => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: TEST_TILE_SIZE }),
    });
    const renderRegion = () => renderer.render(region);

    expect(renderRegion).toThrow(ExporterRangeError);
    expect(renderRegion).toThrow(
      `[${ExporterErrorDefinitions.REGION_EXCEEDS_SAFE_RANGE.code}]`,
    );
  });

  it("does not allocate a tile or buffer while rejecting a region", () => {
    const raster = new Raster({ tileSize: TEST_TILE_SIZE });
    const renderer = new ExportRenderer({ raster });

    expect(() =>
      renderer.render({
        x: 0,
        y: 0,
        width: Number.MAX_SAFE_INTEGER,
        height: 1,
      }),
    ).toThrow(ExporterRangeError);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });
});

describe("ExportRenderer large regions", () => {
  it("exports a 1920 by 1080 region in one pass", () => {
    const raster = new Raster({ tileSize: 16 });
    const topLeft = createColor(1, 2, 3, 255);
    const bottomRight = createColor(4, 5, 6, 255);
    raster.setPixel({ x: 0, y: 0 }, topLeft);
    raster.setPixel({ x: 1919, y: 1079 }, bottomRight);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 1920, height: 1080 });

    expect(result.pixels.length).toBe(1920 * 1080 * RGBA_CHANNEL_COUNT);
    expect(readExportedPixel(result, 0, 0)).toEqual(toChannels(topLeft));
    expect(readExportedPixel(result, 1000, 500)).toEqual(TRANSPARENT_PIXEL);
    expect(readExportedPixel(result, 1919, 1079)).toEqual(
      toChannels(bottomRight),
    );
  });

  it("exports a 3840 by 2160 region in one pass", () => {
    const raster = new Raster({ tileSize: 16 });
    const corner = createColor(7, 8, 9, 255);
    raster.setPixel({ x: 3839, y: 2159 }, corner);
    const renderer = new ExportRenderer({ raster });

    const result = renderer.render({ x: 0, y: 0, width: 3840, height: 2160 });

    expect(result.pixels.length).toBe(3840 * 2160 * RGBA_CHANNEL_COUNT);
    expect(readExportedPixel(result, 3839, 2159)).toEqual(toChannels(corner));
  });
});
