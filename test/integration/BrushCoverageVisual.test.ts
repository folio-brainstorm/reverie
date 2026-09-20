import { describe, expect, it } from "vitest";

import { CircleBrush, Raster, Stroke } from "@reverie/core";
import type { WorldPoint } from "@reverie/core";

const OPAQUE_INK = { r: 10, g: 20, b: 30, a: 255 };

describe("CircleBrush fixed pixel coverage", () => {
  it("keeps the integer-center circle alpha matrix stable", () => {
    const raster = stampCircle(4, { x: 3, y: 3 });

    expect(collectAlphaMatrix(raster, 0, 0, 6, 6)).toEqual([
      [0, 0, 0, 0, 0, 0],
      [0, 97, 234, 234, 97, 0],
      [0, 234, 255, 255, 234, 0],
      [0, 234, 255, 255, 234, 0],
      [0, 97, 234, 234, 97, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
  });

  it("keeps the fractional-center circle alpha matrix stable", () => {
    const raster = stampCircle(4, { x: 3.25, y: 2.75 });

    expect(collectAlphaMatrix(raster, 0, 0, 6, 6)).toEqual([
      [0, 0, 33, 60, 0, 0],
      [0, 89, 255, 255, 187, 0],
      [0, 187, 255, 255, 255, 60],
      [0, 152, 255, 255, 255, 33],
      [0, 6, 152, 187, 89, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
  });

  it("keeps a thin diagonal stroke alpha matrix stable", () => {
    const raster = paintStroke([
      { x: 1.25, y: 1.25 },
      { x: 5.75, y: 5.75 },
    ]);

    expect(collectAlphaMatrix(raster, 0, 0, 7, 7)).toEqual([
      [0, 67, 0, 0, 0, 0, 0],
      [67, 255, 180, 0, 0, 0, 0],
      [0, 180, 255, 179, 0, 0, 0],
      [0, 0, 179, 255, 180, 0, 0],
      [0, 0, 0, 180, 255, 179, 0],
      [0, 0, 0, 0, 179, 255, 39],
      [0, 0, 0, 0, 0, 39, 0],
    ]);
  });

  it("keeps a shallow-angle stroke alpha matrix stable", () => {
    const raster = paintStroke([
      { x: 0.5, y: 1.5 },
      { x: 7.5, y: 3.5 },
    ]);

    expect(collectAlphaMatrix(raster, 0, 0, 9, 6)).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [255, 253, 230, 110, 0, 0, 0, 0, 0],
      [13, 187, 248, 254, 254, 248, 188, 13, 0],
      [0, 0, 0, 0, 110, 230, 253, 254, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it("keeps a curved stroke alpha matrix stable", () => {
    const raster = paintStroke([
      { x: 1.5, y: 4.5 },
      { x: 1.8, y: 2.6 },
      { x: 3.5, y: 1.5 },
      { x: 5.2, y: 2.6 },
      { x: 5.5, y: 4.5 },
    ]);

    expect(collectAlphaMatrix(raster, 0, 0, 7, 6)).toEqual([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 231, 255, 232, 0, 0],
      [0, 247, 253, 158, 253, 248, 0],
      [0, 254, 105, 0, 105, 254, 0],
      [0, 255, 2, 0, 0, 211, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it("keeps the fractional erase matrix stable", () => {
    const raster = new Raster({ tileSize: 4 });
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        raster.setPixel({ x, y }, { r: 220, g: 30, b: 10, a: 255 });
      }
    }

    const brush = new CircleBrush({ size: 4, color: OPAQUE_INK });
    const position = { x: 3, y: 3 };
    brush.stamp(raster, position, { position, paintMode: "erase" });

    expect(collectAlphaMatrix(raster, 0, 0, 6, 6)).toEqual([
      [255, 255, 255, 255, 255, 255],
      [255, 158, 21, 21, 158, 255],
      [255, 21, 0, 0, 21, 255],
      [255, 21, 0, 0, 21, 255],
      [255, 158, 21, 21, 158, 255],
      [255, 255, 255, 255, 255, 255],
    ]);
  });
});

/** Stamps one standard opaque circle into a small sparse raster. */
function stampCircle(size: number, position: WorldPoint): Raster {
  const raster = new Raster({ tileSize: 4 });
  const brush = new CircleBrush({ size, color: OPAQUE_INK });

  brush.stamp(raster, position);

  return raster;
}

/** Executes one deterministic, closely spaced stroke through its public queue. */
function paintStroke(points: readonly WorldPoint[]): Raster {
  const raster = new Raster({ tileSize: 4 });
  const brush = new CircleBrush({
    size: 1,
    spacing: 0.25,
    color: OPAQUE_INK,
  });
  const stroke = new Stroke({
    brush,
    smoothing: 1,
    resampleDistance: 0.25,
  });

  points.forEach((position, index) => {
    stroke.addSample({ position, timestamp: index });
  });

  for (
    let command = stroke.nextStamp();
    command !== undefined;
    command = stroke.nextStamp()
  ) {
    brush.stamp(raster, command.position, command);
  }

  return raster;
}

/** Reads a rectangular alpha region without depending on Tile layout. */
function collectAlphaMatrix(
  raster: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): number[][] {
  return Array.from({ length: height }, (_, rowIndex) =>
    Array.from(
      { length: width },
      (_, columnIndex) =>
        raster.getPixel({
          x: left + columnIndex,
          y: top + rowIndex,
        }).a,
    ),
  );
}
