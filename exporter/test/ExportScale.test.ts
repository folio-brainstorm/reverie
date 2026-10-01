import decodeWebp from "@jsquash/webp/decode.js";
import { decode as decodeJpeg } from "jpeg-js";
import { beforeAll, describe, expect, it } from "vitest";

import { Raster, World } from "@reveriejs/core";
import { getRasterTileVersion } from "@reveriejs/core/rendering/internal";

import {
  ExportRenderer,
  ExporterErrorDefinitions,
  ExporterRangeError,
  ExporterTypeError,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "../index.js";
import type { ExportRenderOptions, ExportResult } from "../index.js";

import { initializeWebpDecoder } from "./InitializeWebpDecoder.js";

/** Verifies every destination pixel against its source, including all alpha bytes. */
function expectPixelBlocks(
  native: ExportResult,
  scaled: ExportResult,
  scale: number,
): void {
  expect(scaled.width).toBe(native.width * scale);
  expect(scaled.height).toBe(native.height * scale);
  expect(scaled.pixels.length).toBe(scaled.width * scaled.height * 4);
  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const sourceOffset =
        (Math.floor(y / scale) * native.width + Math.floor(x / scale)) * 4;
      const outputOffset = (y * scaled.width + x) * 4;
      expect(scaled.pixels.slice(outputOffset, outputOffset + 4)).toEqual(
        native.pixels.slice(sourceOffset, sourceOffset + 4),
      );
    }
  }
}

describe("ExportRenderer scale", () => {
  it("defaults to byte-identical 1x output and keeps each result independently owned", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 12, g: 34, b: 56, a: 128 });
    const renderer = new ExportRenderer({ raster });
    const region = { x: 0, y: 0, width: 2, height: 1 };
    const native = renderer.render(region);
    for (const options of [{}, { scale: 1 }]) {
      const result = renderer.render(region, options);
      expect(result).toEqual(native);
      expect(result.pixels).not.toBe(native.pixels);
    }
  });

  it.each([2, 3, 4, 8, 16])(
    "copies exact RGBA blocks at %sx across negative coordinates and tiles",
    (scale) => {
      const raster = new Raster({ tileSize: 2 });
      raster.setPixel({ x: -1, y: -1 }, { r: 11, g: 22, b: 33, a: 255 });
      raster.setPixel({ x: 0, y: -1 }, { r: 44, g: 55, b: 66, a: 128 });
      raster.setPixel({ x: 1, y: 0 }, { r: 77, g: 88, b: 99, a: 0 });
      const version = getRasterTileVersion(raster, { x: 0, y: 0 });
      const renderer = new ExportRenderer({ raster });
      const region = Object.freeze({ x: -1, y: -1, width: 3, height: 2 });
      const options: ExportRenderOptions = Object.freeze({ scale });
      const native = renderer.render(region);
      const result = renderer.render(region, options);
      expectPixelBlocks(native, result, scale);
      expect(getRasterTileVersion(raster, { x: 0, y: 0 })).toEqual(version);
      result.pixels.fill(0);
      expect(renderer.render(region)).toEqual(native);
    },
  );

  it("scales after World clipping, visibility, opacity and blend composition", () => {
    const world = new World({
      tileSize: 2,
      bounds: { x: -1, y: -1, width: 2, height: 2 },
    });
    world
      .getLayer(0)
      .raster.setPixel({ x: -1, y: -1 }, { r: 100, g: 100, b: 100, a: 255 });
    const top = world.addLayer();
    top.raster.setPixel({ x: -1, y: -1 }, { r: 200, g: 150, b: 50, a: 255 });
    top.blendMode = "multiply";
    top.opacity = 0.5;
    top.raster.setPixel({ x: 1, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    const hidden = world.addLayer();
    hidden.raster.setPixel({ x: -1, y: -1 }, { r: 255, g: 0, b: 0, a: 255 });
    hidden.visible = false;
    const renderer = new ExportRenderer({ world });
    const region = { x: -2, y: -2, width: 4, height: 3 };
    const native = renderer.render(region);
    expect(Array.from(native.pixels.slice(20, 24))).toEqual([89, 80, 60, 255]);
    expect(Array.from(native.pixels.slice(44, 48))).toEqual([0, 0, 0, 0]);
    expectPixelBlocks(native, renderer.render(region, { scale: 3 }), 3);
  });

  it.each([
    0,
    -1,
    0.5,
    1.5,
    16.5,
    17,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER,
  ])("rejects invalid scale %s at the export API", (scale) => {
    const renderer = new ExportRenderer({
      raster: new Raster({ tileSize: 2 }),
    });
    const render = () =>
      renderer.render({ x: 0, y: 0, width: 1, height: 1 }, { scale });
    expect(render).toThrow(ExporterRangeError);
    expect(render).toThrow(ExporterErrorDefinitions.INVALID_EXPORT_SCALE.code);
  });

  it.each([null, "2", true, {}])(
    "rejects nonnumeric scale %s without coercion",
    (scale) => {
      const renderer = new ExportRenderer({
        raster: new Raster({ tileSize: 2 }),
      });
      const render = () =>
        renderer.render(
          { x: 0, y: 0, width: 1, height: 1 },
          // @ts-expect-error Runtime validation protects JavaScript consumers.
          { scale },
        );
      expect(render).toThrow(ExporterTypeError);
      expect(render).toThrow(
        ExporterErrorDefinitions.INVALID_EXPORT_SCALE_TYPE.code,
      );
    },
  );

  it.each([
    { width: 2 ** 49, height: 1 },
    { width: 1, height: 2 ** 49 },
    { width: 2 ** 24, height: 2 ** 24 },
    { width: 2 ** 21, height: 2 ** 22 },
  ])(
    "rejects unsafe scaled dimensions, pixel count or byte length before allocation: %j",
    (size) => {
      const renderer = new ExportRenderer({
        raster: new Raster({ tileSize: 2 }),
      });
      const render = () =>
        renderer.render({ x: 0, y: 0, ...size }, { scale: 16 });
      expect(render).toThrow(ExporterRangeError);
      expect(render).toThrow(
        ExporterErrorDefinitions.SCALED_OUTPUT_EXCEEDS_SAFE_RANGE.code,
      );
    },
  );
});

describe("Scaled bitmap encoding", () => {
  beforeAll(initializeWebpDecoder);

  it("uses scaled dimensions in PNG, JPEG and WebP and preserves lossless WebP pixels", async () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, { r: 200, g: 50, b: 100, a: 255 });
    raster.setPixel({ x: 1, y: 0 }, { r: 50, g: 100, b: 200, a: 128 });
    const bitmap = new ExportRenderer({ raster }).render(
      { x: 0, y: 0, width: 2, height: 1 },
      { scale: 4 },
    );
    const original = bitmap.pixels.slice();
    const png = await new PNGEncoder().encode(bitmap);
    const pngHeader = new DataView(
      png.data.buffer,
      png.data.byteOffset,
      png.data.byteLength,
    );
    expect(pngHeader.getUint32(16)).toBe(8);
    expect(pngHeader.getUint32(20)).toBe(4);
    const jpeg = decodeJpeg((await new JPEGEncoder().encode(bitmap)).data);
    expect(jpeg.width).toBe(8);
    expect(jpeg.height).toBe(4);
    const webp = await new WebPEncoder().encode(bitmap, { lossless: true });
    const decoded = await decodeWebp(new Uint8Array(webp.data).buffer);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(4);
    expect(decoded.data).toEqual(bitmap.pixels);
    expect(bitmap.pixels).toEqual(original);
  });
});
