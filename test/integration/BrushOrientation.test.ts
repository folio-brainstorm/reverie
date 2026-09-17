import { describe, expect, it } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ErrorCodes,
  ImageBrush,
  Raster,
  ReverieRangeError,
  Stroke,
} from "@reverie/core";
import type {
  BrushDynamics,
  CircleBrushConfig,
  DirectionDynamics,
  ImageBrushConfig,
  RGBAColor,
  StampCommand,
} from "@reverie/core";

const OPAQUE_GREEN: RGBAColor = { r: 0, g: 255, b: 0, a: 255 };
const STAMP_POSITION = { x: 0.5, y: 0.5 };

describe("Brush base orientation", () => {
  it("exposes direction and rotation through public configuration types", () => {
    const direction: DirectionDynamics = {};
    const circleConfig: CircleBrushConfig = {
      size: 4,
      color: OPAQUE_GREEN,
      rotation: Math.PI / 4,
      dynamics: { rotation: { direction } },
    };
    const imageConfig: ImageBrushConfig = {
      image: asymmetricImage(),
      size: 2,
      color: OPAQUE_GREEN,
      rotation: -Math.PI / 4,
      dynamics: { rotation: { direction } },
    };

    expect(new CircleBrush(circleConfig).rotation).toBe(Math.PI / 4);
    expect(new ImageBrush(imageConfig).rotation).toBe(-Math.PI / 4);
  });

  it("defaults both built-in brushes to zero base rotation", () => {
    expect(createCircleBrush().rotation).toBe(0);
    expect(createImageBrush().rotation).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite base rotation %s",
    (rotation) => {
      const createCircle = () => createCircleBrush(rotation);
      const createImage = () => createImageBrush(rotation);

      expect(createCircle).toThrow(ReverieRangeError);
      expect(createCircle).toThrow(`[${ErrorCodes.BRUSH.INVALID_ROTATION}]`);
      expect(createImage).toThrow(ReverieRangeError);
      expect(createImage).toThrow(`[${ErrorCodes.BRUSH.INVALID_ROTATION}]`);
    },
  );
});

describe("Brush rotation composition", () => {
  it("uses base rotation when no orientation mapping is enabled", () => {
    const brush = createCircleBrush(Math.PI / 4);

    expect(
      brush.resolveParameters(createStamp({ direction: Math.PI / 2 })).rotation,
    ).toBeCloseTo(Math.PI / 4);
  });

  it("adds direction to base rotation when path following is enabled", () => {
    const brush = createCircleBrush(Math.PI / 4, {
      rotation: { direction: {} },
    });

    expect(
      brush.resolveParameters(createStamp({ direction: Math.PI / 2 })).rotation,
    ).toBeCloseTo((3 * Math.PI) / 4);
  });

  it("uses zero direction contribution for the first stamp", () => {
    const brush = createCircleBrush(Math.PI / 4, {
      rotation: { direction: {} },
    });

    expect(brush.resolveParameters(createStamp()).rotation).toBeCloseTo(
      Math.PI / 4,
    );
  });

  it("adds tilt to base rotation when direction following is disabled", () => {
    const brush = createCircleBrush(Math.PI / 4, {
      rotation: { tilt: {} },
    });

    expect(
      brush.resolveParameters(
        createStamp({
          direction: Math.PI / 2,
          tiltX: 45,
          tiltY: -45,
        }),
      ).rotation,
    ).toBeCloseTo(0);
  });

  it("adds base, direction, and tilt without overriding any source", () => {
    const brush = createCircleBrush(Math.PI / 4, {
      rotation: { direction: {}, tilt: {} },
    });

    expect(
      brush.resolveParameters(
        createStamp({
          direction: Math.PI / 2,
          tiltX: 45,
          tiltY: -45,
        }),
      ).rotation,
    ).toBeCloseTo(Math.PI / 2);
  });

  it("accepts finite unnormalized direction angles", () => {
    const brush = createCircleBrush(0, { rotation: { direction: {} } });

    expect(
      brush.resolveParameters(createStamp({ direction: Math.PI * 4 })).rotation,
    ).toBeCloseTo(Math.PI * 4);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite enabled direction %s",
    (direction) => {
      const brush = createCircleBrush(0, {
        rotation: { direction: {} },
      });
      const resolve = () => brush.resolveParameters(createStamp({ direction }));

      expect(resolve).toThrow(`[${ErrorCodes.BRUSH.INVALID_DYNAMICS_INPUT}]`);
    },
  );

  it("rejects a malformed direction marker", () => {
    const createBrush = () =>
      new CircleBrush({
        size: 4,
        color: OPAQUE_GREEN,
        dynamics: {
          rotation: {
            // @ts-expect-error Runtime validation protects JavaScript callers.
            direction: null,
          },
        },
      });

    expect(createBrush).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_DYNAMICS_OBJECT}]`,
    );
  });

  it("rejects a non-finite composed rotation", () => {
    const brush = createCircleBrush(Number.MAX_VALUE, {
      rotation: { direction: {} },
    });
    const resolve = () =>
      brush.resolveParameters(createStamp({ direction: Number.MAX_VALUE }));

    expect(resolve).toThrow(
      `[${ErrorCodes.BRUSH.INVALID_RESOLVED_PARAMETERS}]`,
    );
  });
});

describe("Brush orientation rendering", () => {
  it("keeps CircleBrush pixels unchanged for every orientation source", () => {
    const neutralBrush = createCircleBrush();
    const orientedBrush = createCircleBrush(Math.PI / 3, {
      rotation: { direction: {}, tilt: {} },
    });
    const neutralRaster = new Raster();
    const orientedRaster = new Raster();

    neutralBrush.stamp(neutralRaster, STAMP_POSITION);
    orientedBrush.stamp(
      orientedRaster,
      STAMP_POSITION,
      createStamp({ direction: Math.PI / 2, tiltX: 45, tiltY: 45 }),
    );

    expectRasterRegionToMatch(neutralRaster, orientedRaster, -3, 3);
  });

  it.each([
    [0, { x: 0, y: 0 }],
    [Math.PI / 2, { x: -1, y: 0 }],
    [Math.PI, { x: -1, y: -1 }],
    [-Math.PI / 2, { x: 0, y: -1 }],
  ])("points ImageBrush local +X along direction %s", (direction, expected) => {
    const brush = createImageBrush(0, {
      rotation: { direction: {} },
    });
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 }, createStamp({ direction }));

    expect(raster.getPixel(expected).a).toBe(255);
  });

  it("applies static ImageBrush rotation around its custom anchor", () => {
    const brush = createImageBrush(Math.PI / 2);
    const raster = new Raster();

    brush.stamp(raster, { x: 0, y: 0 });

    expect(raster.getPixel({ x: -1, y: 0 }).a).toBe(255);
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it("uses direction produced by an actual Stroke to orient ImageBrush", () => {
    const brush = createImageBrush(0, {
      rotation: { direction: {} },
    });
    const stroke = new Stroke({ brush, resampleDistance: 2 });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 0, y: 2 }, timestamp: 2 });
    stroke.nextStamp();
    const downwardStamp = stroke.nextStamp();
    const raster = new Raster();

    expect(downwardStamp?.direction).toBeCloseTo(Math.PI / 2);

    if (downwardStamp !== undefined) {
      brush.stamp(raster, downwardStamp.position, downwardStamp);
    }

    expect(raster.getPixel({ x: -1, y: 2 }).a).toBe(255);
  });

  it("preserves Step 19 output when direction following is disabled", () => {
    const legacyBrush = createImageBrush();
    const disabledBrush = createImageBrush(0, { rotation: {} });
    const legacyRaster = new Raster();
    const disabledRaster = new Raster();
    const input = createStamp({ direction: Math.PI / 2 });

    legacyBrush.stamp(legacyRaster, { x: 0, y: 0 }, input);
    disabledBrush.stamp(disabledRaster, { x: 0, y: 0 }, input);

    expectRasterRegionToMatch(legacyRaster, disabledRaster, -2, 2);
  });
});

/** Creates a standard circle brush with selected orientation inputs. */
function createCircleBrush(
  rotation = 0,
  dynamics?: BrushDynamics,
): CircleBrush {
  return new CircleBrush({
    size: 4,
    color: OPAQUE_GREEN,
    rotation,
    ...(dynamics === undefined ? {} : { dynamics }),
  });
}

/** Creates an anchored asymmetric image brush with selected orientation inputs. */
function createImageBrush(rotation = 0, dynamics?: BrushDynamics): ImageBrush {
  return new ImageBrush({
    image: asymmetricImage(),
    size: 2,
    color: OPAQUE_GREEN,
    anchor: { x: 0, y: 0 },
    spacing: 1,
    rotation,
    ...(dynamics === undefined ? {} : { dynamics }),
  });
}

/** Creates a two-pixel tip whose first pixel identifies its orientation. */
function asymmetricImage(): BrushImage {
  return new BrushImage({
    width: 2,
    height: 1,
    alpha: new Uint8Array([255, 0]),
  });
}

/** Creates one hand-authored stamp with neutral input defaults. */
function createStamp(overrides: Partial<StampCommand> = {}): StampCommand {
  return {
    position: STAMP_POSITION,
    timestamp: 0,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    velocity: 0,
    ...overrides,
  };
}

/** Compares a square observable raster region pixel by pixel. */
function expectRasterRegionToMatch(
  first: Raster,
  second: Raster,
  minimum: number,
  maximum: number,
): void {
  for (let y = minimum; y <= maximum; y += 1) {
    for (let x = minimum; x <= maximum; x += 1) {
      expect(first.getPixel({ x, y })).toEqual(second.getPixel({ x, y }));
    }
  }
}
