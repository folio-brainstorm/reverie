import { describe, expect, it } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ErrorCodes,
  ImageBrush,
  paintPixel,
  Raster,
  Stroke,
  World,
} from "@reverie/core";

const RED = { r: 220, g: 30, b: 10, a: 255 };

describe("Brush paint modes", () => {
  it("applies erase through the generalized paint operation", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    paintPixel(
      raster,
      { pixel: { x: 0, y: 0 }, coverage: 0.5 },
      { color: RED, opacity: 0.5, mode: "erase" },
    );
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...RED, a: 191 });
  });

  it("reports invalid direct erase amounts with an erase-specific error", () => {
    const raster = new Raster();
    expect(() => raster.erasePixel({ x: 0, y: 0 }, -0.1)).toThrow(
      ErrorCodes.PAINT.INVALID_ERASE_AMOUNT,
    );
  });

  it("keeps default and explicit paint stamps byte-identical", () => {
    const brush = new CircleBrush({ size: 1, color: RED, opacity: 0.5 });
    const defaultRaster = new Raster({ tileSize: 2 });
    const explicitRaster = new Raster({ tileSize: 2 });

    brush.stamp(defaultRaster, { x: 0.5, y: 0.5 });
    brush.stamp(
      explicitRaster,
      { x: 0.5, y: 0.5 },
      { position: { x: 0.5, y: 0.5 }, paintMode: "paint" },
    );

    expect(explicitRaster.getPixel({ x: 0, y: 0 })).toEqual(
      defaultRaster.getPixel({ x: 0, y: 0 }),
    );
  });

  it("erases alpha destructively while preserving RGB and compounds partial stamps", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    const brush = new CircleBrush({
      size: 1,
      color: { ...RED, a: 0 },
      opacity: 0.5,
    });
    const erase = { position: { x: 0.5, y: 0.5 }, paintMode: "erase" as const };

    brush.stamp(raster, erase.position, erase);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...RED, a: 128 });
    brush.stamp(raster, erase.position, erase);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...RED, a: 64 });
  });

  it("applies fractional circle-edge coverage to erase strength", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 1, y: 0 }, RED);
    const brush = new CircleBrush({ size: 2, color: RED });

    brush.stamp(
      raster,
      { x: 0.5, y: 0.5 },
      { position: { x: 0.5, y: 0.5 }, paintMode: "erase" },
    );

    expect(raster.getPixel({ x: 1, y: 0 })).toEqual({ ...RED, a: 128 });
  });

  it("fully erases without clearing transparent RGB and skips missing tiles", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    const brush = new CircleBrush({ size: 1, color: RED });
    const erase = { position: { x: 0.5, y: 0.5 }, paintMode: "erase" as const };

    brush.stamp(raster, erase.position, erase);
    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({ ...RED, a: 0 });
    brush.stamp(raster, { x: 1_000.5, y: 1_000.5 }, erase);
    expect(raster.allocatedTileCount).toBe(1);
  });

  it("uses ImageBrush alpha as erase coverage", () => {
    const raster = new Raster({ tileSize: 2 });
    raster.setPixel({ x: 0, y: 0 }, RED);
    raster.setPixel({ x: 1, y: 0 }, RED);
    const brush = new ImageBrush({
      image: new BrushImage({
        width: 2,
        height: 1,
        alpha: new Uint8Array([255, 0]),
      }),
      size: 2,
      color: RED,
      anchor: { x: 0, y: 0 },
    });

    brush.stamp(
      raster,
      { x: 0, y: 0 },
      { position: { x: 0, y: 0 }, paintMode: "erase" },
    );
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    expect(raster.getPixel({ x: 1, y: 0 })).toEqual(RED);
  });

  it("captures erase mode in Stroke commands and rejects unsupported modes", () => {
    const brush = new CircleBrush({ size: 1, color: RED });
    const stroke = new Stroke({ brush, paintMode: "erase" });
    stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
    expect(stroke.nextStamp()?.paintMode).toBe("erase");
    expect(
      () =>
        // @ts-expect-error JavaScript callers may supply an unsupported mode.
        new Stroke({ brush, paintMode: "smudge" }),
    ).toThrow(ErrorCodes.PAINT.INVALID_MODE);
  });

  it("clips erase stamps to their target layer without changing lower layers", () => {
    const world = new World({
      tileSize: 2,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    bottom.raster.setPixel({ x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 255 });
    top.raster.setPixel({ x: 0, y: 0 }, RED);
    const brush = new CircleBrush({ size: 1, color: RED });

    top.stamp(
      brush,
      { x: 0.5, y: 0.5 },
      { position: { x: 0.5, y: 0.5 }, paintMode: "erase" },
    );
    top.stamp(
      brush,
      { x: 2.5, y: 0.5 },
      { position: { x: 2.5, y: 0.5 }, paintMode: "erase" },
    );
    expect(top.raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    expect(bottom.raster.getPixel({ x: 0, y: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 255,
    });
    expect(top.raster.getPixel({ x: 2, y: 0 }).a).toBe(0);
  });
});
