import { describe, expect, it, vi } from "vitest";

import {
  BrushImage,
  ErrorCodes,
  ImageBrush,
  Raster,
  ReverieRangeError,
  World,
} from "@reveriejs/core";
import type {
  Brush,
  ImageBrushConfig,
  RGBAColor,
  StampCommand,
} from "@reveriejs/core";

const OPAQUE_RED: RGBAColor = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };

describe("ImageBrush construction", () => {
  it("is available as a Brush with public config and stable defaults", () => {
    const image = opaqueImage(2, 1);
    const config: ImageBrushConfig = { image, size: 20, color: OPAQUE_RED };
    const brush: Brush = new ImageBrush(config);

    expect(brush).toBeInstanceOf(ImageBrush);
    expect(brush.size).toBe(20);
    expect(brush.spacing).toBe(0.25);
    expect((brush as ImageBrush).opacity).toBe(1);
    expect((brush as ImageBrush).anchor).toEqual({ x: 0.5, y: 0.5 });
  });

  it("owns color and anchor while reusing the immutable BrushImage", () => {
    const image = opaqueImage(1, 1);
    const color = { ...OPAQUE_RED };
    const anchor = { x: 0.25, y: 0.75 };
    const brush = new ImageBrush({ image, size: 1, color, anchor });

    color.r = 0;
    anchor.x = 1;
    brush.color.g = 255;
    // @ts-expect-error Returned anchors remain readonly for typed callers.
    brush.anchor.y = 0;

    expect(brush.image).toBe(image);
    expect(brush.color).toEqual(OPAQUE_RED);
    expect(brush.anchor).toEqual({ x: 0.25, y: 0.75 });
  });

  it("allows one BrushImage to back brushes with different parameters", () => {
    const image = opaqueImage(1, 1);
    const first = new ImageBrush({ image, size: 1, color: OPAQUE_RED });
    const second = new ImageBrush({
      image,
      size: 2,
      color: { r: 0, g: 0, b: 255, a: 255 },
      anchor: { x: 0, y: 0 },
    });

    expect(first.image).toBe(second.image);
    expect(first.size).toBe(1);
    expect(second.size).toBe(2);
    expect(first.color).not.toEqual(second.color);
  });

  it("rejects a non-BrushImage source at runtime", () => {
    const createBrush = () =>
      new ImageBrush({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        image: { width: 1, height: 1, alpha: new Uint8Array([255]) },
        size: 1,
        color: OPAQUE_RED,
      });

    expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_BRUSH_IMAGE}]`);
  });

  it.each([
    { x: -0.1, y: 0.5 },
    { x: 1.1, y: 0.5 },
    { x: 0.5, y: Number.NaN },
    { x: 0.5, y: Number.POSITIVE_INFINITY },
  ])("rejects invalid anchor $x, $y", (anchor) => {
    const createBrush = () =>
      new ImageBrush({
        image: opaqueImage(1, 1),
        size: 1,
        color: OPAQUE_RED,
        anchor,
      });

    expect(createBrush).toThrow(ReverieRangeError);
    expect(createBrush).toThrow(`[${ErrorCodes.BRUSH.INVALID_IMAGE_ANCHOR}]`);
  });
});

describe("ImageBrush alpha, color, and aspect ratio", () => {
  it("uses source alpha as coverage and Brush color as RGB", () => {
    const image = new BrushImage({
      width: 2,
      height: 2,
      alpha: new Uint8Array([0, 255, 255, 0]),
    });
    const brush = new ImageBrush({
      image,
      size: 2,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(TRANSPARENT_BLACK);
    expect(raster.getPixel({ x: 1, y: 0 })).toEqual(OPAQUE_RED);
    expect(raster.getPixel({ x: 0, y: 1 })).toEqual(OPAQUE_RED);
    expect(raster.getPixel({ x: 1, y: 1 })).toEqual(TRANSPARENT_BLACK);
  });

  it("paints an image without alpha as a fully opaque mask", () => {
    const brush = new ImageBrush({
      image: new BrushImage({ width: 2, height: 1 }),
      size: 2,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual(OPAQUE_RED);
    expect(raster.getPixel({ x: 1, y: 0 })).toEqual(OPAQUE_RED);
  });

  it("produces identical paint when source RGB differs but alpha matches", () => {
    const redSource = BrushImage.fromRGBA({
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 64]),
    });
    const blueSource = BrushImage.fromRGBA({
      width: 2,
      height: 1,
      pixels: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 64]),
    });
    const redSourceRaster = new Raster();
    const blueSourceRaster = new Raster();

    new ImageBrush({
      image: redSource,
      size: 2,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    }).stamp(redSourceRaster, { x: 0, y: 0 });
    new ImageBrush({
      image: blueSource,
      size: 2,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    }).stamp(blueSourceRaster, { x: 0, y: 0 });

    expect(redSourceRaster.getPixel({ x: 0, y: 0 })).toEqual(
      blueSourceRaster.getPixel({ x: 0, y: 0 }),
    );
    expect(redSourceRaster.getPixel({ x: 1, y: 0 })).toEqual(
      blueSourceRaster.getPixel({ x: 1, y: 0 }),
    );
  });

  it.each([
    [4, 2, { x: 3, y: 1 }, { x: 3, y: 2 }],
    [2, 4, { x: 1, y: 3 }, { x: 2, y: 3 }],
    [3, 3, { x: 2, y: 2 }, { x: 4, y: 2 }],
  ])(
    "preserves the %s by %s source aspect ratio",
    (width, height, inside, outside) => {
      const brush = new ImageBrush({
        image: opaqueImage(width, height),
        size: 4,
        color: OPAQUE_RED,
        anchor: { x: 0, y: 0 },
      });
      const raster = new Raster();

      brush.stamp(raster, { x: 0, y: 0 });

      expect(raster.getPixel(inside).a).toBe(255);
      expect(raster.getPixel(outside).a).toBe(0);
    },
  );

  it("applies resolved opacity exactly once through Source Over", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
      opacity: 0.5,
      anchor: { x: 0, y: 0 },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 });

    expect(raster.getPixel({ x: 0, y: 0 })).toEqual({
      ...OPAQUE_RED,
      a: 128,
    });
  });
});

describe("ImageBrush anchors and rotation", () => {
  it("centers the default anchor on the stamp position", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 10.5, y: 20.5 });

    expect(raster.getPixel({ x: 10, y: 20 })).toEqual(OPAQUE_RED);
  });

  it.each([
    [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ],
    [
      { x: 1, y: 1 },
      { x: 11, y: 21 },
    ],
  ])("places custom anchor %j at the stamp", (anchor, position) => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
      anchor,
    });
    const raster = new Raster();

    brush.stamp(raster, position);

    expect(raster.getPixel({ x: 10, y: 20 })).toEqual(OPAQUE_RED);
  });

  it.each([
    [0, 0, { x: 0, y: 0 }],
    [0, 45, { x: -1, y: 0 }],
    [-45, 0, { x: -1, y: -1 }],
    [0, -45, { x: 0, y: -1 }],
  ])(
    "rotates an asymmetric image around its anchor for tilt (%s, %s)",
    (tiltX, tiltY, expectedPixel) => {
      const image = new BrushImage({
        width: 2,
        height: 1,
        alpha: new Uint8Array([255, 0]),
      });
      const brush = new ImageBrush({
        image,
        size: 2,
        color: OPAQUE_RED,
        anchor: { x: 0, y: 0 },
        dynamics: { rotation: { tilt: {} } },
      });
      const raster = new Raster();

      brush.stamp(raster, { x: 0, y: 0 }, createStamp({ tiltX, tiltY }));

      expect(raster.getPixel(expectedPixel).a).toBe(255);
    },
  );
});

describe("ImageBrush dynamics", () => {
  it("scales each stamp from its independently resolved size", () => {
    const brush = new ImageBrush({
      image: opaqueImage(2, 2),
      size: 4,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
      dynamics: { size: { pressure: { min: 0 } } },
    });
    const smallRaster = new Raster();
    const baseRaster = new Raster();

    brush.stamp(smallRaster, { x: 0, y: 0 }, createStamp({ pressure: 0.5 }));
    brush.stamp(baseRaster, { x: 0, y: 0 }, createStamp({ pressure: 1 }));

    expect(smallRaster.getPixel({ x: 2, y: 0 }).a).toBe(0);
    expect(baseRaster.getPixel({ x: 2, y: 0 }).a).toBeGreaterThan(0);
    expect(brush.size).toBe(4);
  });

  it("applies per-stamp dynamic opacity", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
      dynamics: { opacity: { pressure: { min: 0 } } },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 }, createStamp({ pressure: 0.25 }));

    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(64);
  });

  it("performs no sampling or allocation for zero resolved size", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
      dynamics: { size: { pressure: { min: 0 } } },
    });
    const raster = new Raster();
    const sampleAlpha = vi.spyOn(brush.image, "sampleAlpha");

    brush.stamp(raster, { x: 0, y: 0 }, createStamp({ pressure: 0 }));

    expect(sampleAlpha).not.toHaveBeenCalled();
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });
});

describe("ImageBrush spatial behavior", () => {
  it("does not allocate Tiles for a fully transparent image", () => {
    const brush = new ImageBrush({
      image: new BrushImage({
        width: 2,
        height: 2,
        alpha: new Uint8Array(4),
      }),
      size: 100,
      color: OPAQUE_RED,
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 });

    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(0);
    // #endif
  });

  it("supports negative world coordinates", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: -1, y: -1 });

    expect(raster.getPixel({ x: -1, y: -1 })).toEqual(OPAQUE_RED);
  });

  it("clips fixed World writes before outside Tile allocation", () => {
    const world = new World({
      tileSize: 2,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    const layer = world.createRasterLayer();
    const brush = new ImageBrush({
      image: opaqueImage(4, 4),
      size: 4,
      color: OPAQUE_RED,
      anchor: { x: 0, y: 0 },
    });

    layer.stamp(brush, { x: 0, y: 0 });

    expect(layer.raster.getPixel({ x: 1, y: 1 })).toEqual(OPAQUE_RED);
    expect(layer.raster.getPixel({ x: 2, y: 1 })).toEqual(TRANSPARENT_BLACK);
    // #if DEBUG
    expect(layer.raster.allocatedTileCount).toBe(1);
    // #endif
  });

  it("paints continuously across a four-Tile intersection", () => {
    const raster = new Raster({ tileSize: 2 });
    const brush = new ImageBrush({
      image: opaqueImage(4, 4),
      size: 4,
      color: OPAQUE_RED,
    });

    brush.stamp(raster, { x: 2, y: 2 });

    for (const pixel of [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]) {
      expect(raster.getPixel(pixel)).toEqual(OPAQUE_RED);
    }
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(4);
    // #endif
  });

  it("keeps a rotated stamp continuous across a four-Tile intersection", () => {
    const raster = new Raster({ tileSize: 4 });
    const brush = new ImageBrush({
      image: opaqueImage(4, 2),
      size: 4,
      color: OPAQUE_RED,
      dynamics: { rotation: { tilt: {} } },
    });

    brush.stamp(raster, { x: 4, y: 4 }, createStamp({ tiltX: 45, tiltY: 45 }));

    for (const pixel of [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]) {
      expect(raster.getPixel(pixel).a).toBeGreaterThan(0);
    }
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(4);
    // #endif
  });

  it("is deterministic for identical source, config, and stamp input", () => {
    const brush = new ImageBrush({
      image: new BrushImage({
        width: 2,
        height: 2,
        alpha: new Uint8Array([0, 64, 128, 255]),
      }),
      size: 5,
      color: { r: 10, g: 20, b: 30, a: 200 },
      opacity: 0.75,
      dynamics: { rotation: { tilt: {} } },
    });
    const firstRaster = new Raster();
    const secondRaster = new Raster();
    const stamp = createStamp({ tiltX: 20, tiltY: -10 });

    brush.stamp(firstRaster, { x: 3.25, y: -1.75 }, stamp);
    brush.stamp(secondRaster, { x: 3.25, y: -1.75 }, stamp);

    for (let pixelY = -5; pixelY <= 2; pixelY += 1) {
      for (let pixelX = 0; pixelX <= 7; pixelX += 1) {
        expect(firstRaster.getPixel({ x: pixelX, y: pixelY })).toEqual(
          secondRaster.getPixel({ x: pixelX, y: pixelY }),
        );
      }
    }
  });

  it("handles a 256 by 256 reusable image without runaway allocation", () => {
    const image = opaqueImage(256, 256);
    const brush = new ImageBrush({ image, size: 32, color: OPAQUE_RED });
    const raster = new Raster({ tileSize: 16 });

    brush.stamp(raster, { x: 16, y: 16 });

    expect(raster.getPixel({ x: 16, y: 16 })).toEqual(OPAQUE_RED);
    // #if DEBUG
    expect(raster.allocatedTileCount).toBe(4);
    // #endif
  });

  it("rejects non-finite positions and unsafe transformed bounds", () => {
    const brush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: 1,
      color: OPAQUE_RED,
    });
    const unsafeBrush = new ImageBrush({
      image: opaqueImage(1, 1),
      size: Number.MAX_VALUE,
      color: OPAQUE_RED,
    });

    expect(() => brush.stamp(new Raster(), { x: Number.NaN, y: 0 })).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_IMAGE_STAMP_POSITION}]`,
    );
    expect(() => unsafeBrush.stamp(new Raster(), { x: 0, y: 0 })).toThrow(
      `[${ErrorCodes.BRUSH.UNSAFE_IMAGE_STAMP_BOUNDS}]`,
    );
  });
});

/** Creates a reusable fully opaque alpha mask. */
function opaqueImage(width: number, height: number): BrushImage {
  return new BrushImage({ width, height });
}

/** Creates a complete neutral stamp with selected dynamics overrides. */
function createStamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return {
    position: { x: 0, y: 0 },
    timestamp: 0,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    velocity: 0,
    ...overrides,
  };
}
