import { describe, expect, it } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ErrorCodes,
  ImageBrush,
  PixelBrush,
  Raster,
  ReverieRangeError,
  ReverieTypeError,
  SelectionMask,
  World,
} from "@reveriejs/core";
import type { PixelCoord, SelectionMaskConfig } from "@reveriejs/core";

const OPAQUE_BLUE = { r: 20, g: 80, b: 240, a: 255 };

describe("SelectionMask storage", () => {
  it("is available with its config through the public package entry point", () => {
    const config: SelectionMaskConfig = { tileSize: 4 };
    const selection = new SelectionMask(config);

    expect(selection.tileSize).toBe(4);
    expect(selection.getCoverage(0, 0)).toBe(0);
    expect(selection.allocatedTileCount).toBe(0);
  });

  it("quantizes normalized coverage to the nearest byte", () => {
    const selection = new SelectionMask({ tileSize: 4 });

    selection.setCoverage(-1, -5, 0.5);

    expect(selection.getCoverage(-1, -5)).toBe(128 / 255);
    expect(selection.allocatedTileCount).toBe(1);
  });

  it("does not allocate for reads or zero writes and releases an emptied tile", () => {
    const selection = new SelectionMask({ tileSize: 4 });

    expect(selection.getCoverage(100, 100)).toBe(0);
    selection.setCoverage(100, 100, 0);
    expect(selection.allocatedTileCount).toBe(0);

    selection.setCoverage(100, 100, 1);
    selection.setCoverage(100, 100, 0);
    expect(selection.allocatedTileCount).toBe(0);
  });

  it("clears all coverage while retaining empty-selection semantics", () => {
    const selection = SelectionMask.fromRect(
      { x: -2, y: -2, width: 5, height: 5 },
      { tileSize: 2 },
    );

    expect(selection.allocatedTileCount).toBe(9);
    selection.clear();

    expect(selection.getCoverage(0, 0)).toBe(0);
    expect(selection.allocatedTileCount).toBe(0);
  });

  it("uses half-open rectangle bounds across a four-tile intersection", () => {
    const selection = SelectionMask.fromRect(
      { x: -1, y: -1, width: 2, height: 2 },
      { tileSize: 2 },
    );

    expect(selection.allocatedTileCount).toBe(4);
    expect(readSelectedPixels(selection, -2, -2, 4, 4)).toEqual([
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tile size %s",
    (tileSize) => {
      expect(() => new SelectionMask({ tileSize })).toThrow(
        `[${ErrorCodes.COMMON.UNSAFE_TILE_SIZE}]`,
      );
    },
  );

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid coverage %s without allocating",
    (coverage) => {
      const selection = new SelectionMask();

      expect(() => selection.setCoverage(0, 0, coverage)).toThrow(
        ReverieRangeError,
      );
      expect(() => selection.setCoverage(0, 0, coverage)).toThrow(
        `[${ErrorCodes.SELECTION.INVALID_COVERAGE}]`,
      );
      expect(selection.allocatedTileCount).toBe(0);
    },
  );

  it("rejects malformed coordinates with stable error kinds", () => {
    const selection = new SelectionMask();

    expect(() =>
      selection.getCoverage(
        // @ts-expect-error Runtime validation protects JavaScript callers.
        "0",
        0,
      ),
    ).toThrow(ReverieTypeError);
    expect(() => selection.getCoverage(0.5, 0)).toThrow(
      `[${ErrorCodes.COMMON.UNSAFE_COORDINATE_VALUE}]`,
    );
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 2 },
  ])("rejects invalid rectangle $x,$y $width x $height", (rect) => {
    expect(() => SelectionMask.fromRect(rect)).toThrow(
      `[${ErrorCodes.SELECTION.INVALID_RECT}]`,
    );
  });
});

describe("SelectionMask Brush clipping", () => {
  it("keeps omitted and null Selection output byte-equivalent", () => {
    const unrestricted = new Raster();
    const explicitNull = new Raster();
    const brush = new CircleBrush({ size: 4, color: OPAQUE_BLUE });
    const position = { x: 3, y: 3 };

    brush.stamp(unrestricted, position);
    brush.stamp(explicitNull, position, undefined, null);

    expect(readAlpha(explicitNull, 0, 0, 6, 6)).toEqual(
      readAlpha(unrestricted, 0, 0, 6, 6),
    );
  });

  it("blocks all built-in Brush writes for an empty Selection", () => {
    const selection = new SelectionMask();
    const brushes = [
      new CircleBrush({ size: 4, color: OPAQUE_BLUE }),
      new PixelBrush({ size: 3, color: OPAQUE_BLUE }),
      new ImageBrush({
        image: new BrushImage({
          width: 1,
          height: 1,
          alpha: new Uint8Array([255]),
        }),
        size: 1,
        color: OPAQUE_BLUE,
      }),
    ];

    for (const brush of brushes) {
      const raster = new Raster();
      brush.stamp(raster, { x: 0.5, y: 0.5 }, undefined, selection);
      expect(raster.allocatedTileCount).toBe(0);
    }
  });

  it("keeps a full rectangular Selection equivalent inside its domain", () => {
    const unrestricted = new Raster();
    const selected = new Raster();
    const selection = SelectionMask.fromRect({
      x: -2,
      y: -2,
      width: 5,
      height: 5,
    });
    const brush = new PixelBrush({ size: 3, color: OPAQUE_BLUE });

    brush.stamp(unrestricted, { x: 0.5, y: 0.5 });
    brush.stamp(selected, { x: 0.5, y: 0.5 }, undefined, selection);

    expect(readAlpha(selected, -2, -2, 5, 5)).toEqual(
      readAlpha(unrestricted, -2, -2, 5, 5),
    );
  });

  it("applies fractional coverage before the final alpha quantization", () => {
    const selection = new SelectionMask();
    selection.setCoverage(0, 0, 0.5);
    const raster = new Raster();
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE });

    brush.stamp(raster, { x: 0.5, y: 0.5 }, undefined, selection);

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_BLUE,
      a: 128,
    });
  });

  it("multiplies CircleBrush anti-alias coverage by Selection coverage", () => {
    const selection = new SelectionMask();
    selection.setCoverage(1, 1, 0.5);
    const raster = new Raster();
    const brush = new CircleBrush({ size: 4, color: OPAQUE_BLUE });

    brush.stamp(raster, { x: 3, y: 3 }, undefined, selection);

    expect(raster.getPixel({ x: 1, y: 1 }).a).toBe(48);
    expect(raster.getPixel({ x: 2, y: 2 }).a).toBe(0);
  });

  it("multiplies ImageBrush source alpha by Selection coverage", () => {
    const selection = new SelectionMask();
    selection.setCoverage(0, 0, 0.5);
    const raster = new Raster();
    const brush = new ImageBrush({
      image: new BrushImage({
        width: 1,
        height: 1,
        alpha: new Uint8Array([128]),
      }),
      size: 1,
      color: OPAQUE_BLUE,
    });

    brush.stamp(raster, { x: 0.5, y: 0.5 }, undefined, selection);

    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(64);
  });

  it("uses Selection coverage at the final scattered pixel", () => {
    const brush = new PixelBrush({
      size: 1,
      color: OPAQUE_BLUE,
      seed: 7,
      scatter: { along: 4, across: 4 },
    });
    const input = {
      position: { x: 10.5, y: 10.5 },
      direction: 0.25,
      strokeSeed: 11,
      stampIndex: 3,
    };
    const reference = new Raster();
    brush.stamp(reference, input.position, input);
    const [paintedPixel] = collectPaintedPixels(reference, 0, 0, 24, 24);
    expect(paintedPixel).toBeDefined();
    const selection = new SelectionMask();
    selection.setCoverage(paintedPixel?.x ?? 0, paintedPixel?.y ?? 0, 1);
    const clipped = new Raster();

    brush.stamp(clipped, input.position, input, selection);

    expect(collectPaintedPixels(clipped, 0, 0, 24, 24)).toEqual([paintedPixel]);
  });

  it("applies partial Selection proportionally in erase mode", () => {
    const raster = new Raster();
    raster.setPixel({ x: 0, y: 0 }, OPAQUE_BLUE);
    const selection = new SelectionMask();
    selection.setCoverage(0, 0, 0.5);
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE });
    const input = {
      position: { x: 0.5, y: 0.5 },
      paintMode: "erase" as const,
    };

    brush.stamp(raster, input.position, input, selection);

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_BLUE,
      a: 127,
    });
  });

  it("keeps erase unchanged under an empty Selection", () => {
    const raster = new Raster();
    raster.setPixel({ x: -1, y: -1 }, OPAQUE_BLUE);
    const selection = new SelectionMask();
    const brush = new PixelBrush({ size: 1, color: OPAQUE_BLUE });
    const input = {
      position: { x: -0.5, y: -0.5 },
      paintMode: "erase" as const,
    };

    brush.stamp(raster, input.position, input, selection);

    expect(raster.getPixel({ x: -1, y: -1 })).toEqual(OPAQUE_BLUE);
    expect(raster.allocatedTileCount).toBe(1);
  });

  it("clips continuously where Selection and Raster tile boundaries intersect", () => {
    const selection = SelectionMask.fromRect(
      { x: 1, y: 1, width: 2, height: 2 },
      { tileSize: 2 },
    );
    const raster = new Raster({ tileSize: 2 });
    const brush = new PixelBrush({ size: 2, color: OPAQUE_BLUE });

    brush.stamp(raster, { x: 2, y: 2 }, undefined, selection);

    expect(collectPaintedPixels(raster, 0, 0, 4, 4)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(raster.allocatedTileCount).toBe(4);
  });

  it("composes Selection with World bounds and reuses it across Layers", () => {
    const world = new World({
      tileSize: 2,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    const bottom = world.getLayer(0);
    const top = world.addLayer();
    const selection = SelectionMask.fromRect({
      x: 1,
      y: -1,
      width: 2,
      height: 2,
    });
    const brush = new PixelBrush({ size: 3, color: OPAQUE_BLUE });

    bottom.stamp(brush, { x: 1, y: 0 }, undefined, selection);
    top.stamp(brush, { x: 1, y: 0 }, undefined, selection);

    for (const layer of [bottom, top]) {
      expect(collectPaintedPixels(layer.raster, -1, -1, 4, 4)).toEqual([
        { x: 1, y: 0 },
      ]);
      expect(layer.raster.allocatedTileCount).toBe(1);
    }
  });
});

function readSelectedPixels(
  selection: SelectionMask,
  left: number,
  top: number,
  width: number,
  height: number,
): PixelCoord[] {
  const pixels: PixelCoord[] = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (selection.getCoverage(x, y) > 0) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

function collectPaintedPixels(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): PixelCoord[] {
  const pixels: PixelCoord[] = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (raster.getPixel({ x, y }).a > 0) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

function readAlpha(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): number[] {
  const alpha: number[] = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      alpha.push(raster.getPixel({ x, y }).a);
    }
  }
  return alpha;
}
