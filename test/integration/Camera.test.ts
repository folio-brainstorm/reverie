import { describe, expect, it } from "vitest";

import {
  Camera,
  ErrorCodes,
  ReverieRangeError,
  ReverieTypeError,
} from "@reverie/core";
import type {
  CameraConfig,
  ScreenPoint,
  ViewportSize,
  WorldPoint,
  WorldRect,
} from "@reverie/core";

describe("Camera construction", () => {
  it("is available with its contracts through the public package entry point", () => {
    const config: CameraConfig = { panX: 10, panY: -20, zoom: 2 };
    const screenPoint: ScreenPoint = { x: 20, y: 10 };
    const worldPoint: WorldPoint = { x: 20, y: -15 };
    const viewport: ViewportSize = { width: 800, height: 600 };
    const expectedRect: WorldRect = {
      x: 10,
      y: -20,
      width: 400,
      height: 300,
    };
    const camera = new Camera(config);

    expect(camera.screenToWorld(screenPoint)).toEqual(worldPoint);
    expect(camera.visibleWorldRect(viewport)).toEqual(expectedRect);
  });

  it("defaults to the identity camera", () => {
    const camera = new Camera();

    expect(camera.panX).toBe(0);
    expect(camera.panY).toBe(0);
    expect(camera.zoom).toBe(1);
    expect(camera.screenToWorld({ x: 100, y: 200 })).toEqual({
      x: 100,
      y: 200,
    });

    if (false) {
      // @ts-expect-error Camera pan is changed only through validated methods.
      camera.panX = 100;
      // @ts-expect-error Camera zoom is changed only through validated methods.
      camera.zoom = 2;
    }
  });

  it("uses supplied pan and zoom values without defaulting over them", () => {
    const camera = new Camera({ panX: 200, panY: -100, zoom: 2 });

    expect(camera.panX).toBe(200);
    expect(camera.panY).toBe(-100);
    expect(camera.zoom).toBe(2);
    expect(camera.screenToWorld({ x: 100, y: 50 })).toEqual({
      x: 250,
      y: -75,
    });
  });
});

describe("Camera coordinate conversion", () => {
  it.each([
    [
      { panX: 100, panY: -50, zoom: 1 },
      { x: 20, y: 30 },
      { x: 120, y: -20 },
    ],
    [
      { panX: 0, panY: 0, zoom: 2 },
      { x: 100, y: 100 },
      { x: 50, y: 50 },
    ],
    [
      { panX: 100, panY: 200, zoom: 4 },
      { x: 80, y: 40 },
      { x: 120, y: 210 },
    ],
    [
      { panX: -1_000, panY: -500, zoom: 0.5 },
      { x: 100.25, y: 50.5 },
      { x: -799.5, y: -399 },
    ],
  ] as const)(
    "maps screen coordinates using pan and zoom for camera %#",
    (config, screenPoint, expectedWorldPoint) => {
      const camera = new Camera(config);

      expect(camera.screenToWorld(screenPoint)).toEqual(expectedWorldPoint);
      expect(camera.worldToScreen(expectedWorldPoint)).toEqual(screenPoint);
    },
  );

  it.each([
    [
      { panX: 0, panY: 0, zoom: 1 },
      { x: 0, y: 0 },
    ],
    [
      { panX: 10.25, panY: -30.75, zoom: 0.001 },
      { x: -9.5, y: 1.25 },
    ],
    [
      { panX: -50, panY: 200, zoom: 1_000 },
      { x: 123.456, y: -789.012 },
    ],
    [
      { panX: -1_000_000.5, panY: 2_000_000.25, zoom: 3.75 },
      { x: 987_654.321, y: -123_456.789 },
    ],
  ] as const)(
    "round-trips a screen point for camera state %#",
    (config, screenPoint) => {
      const camera = new Camera(config);
      const worldPoint = camera.screenToWorld(screenPoint);
      const convertedScreenPoint = camera.worldToScreen(worldPoint);

      expect(convertedScreenPoint.x).toBeCloseTo(screenPoint.x);
      expect(convertedScreenPoint.y).toBeCloseTo(screenPoint.y);
    },
  );

  it("preserves fractional coordinates without quantization", () => {
    const camera = new Camera({ zoom: 2 });

    expect(camera.screenToWorld({ x: 101, y: 50.5 })).toEqual({
      x: 50.5,
      y: 25.25,
    });
  });
});

describe("Camera state updates", () => {
  it("sets pan in world coordinates", () => {
    const camera = new Camera();

    camera.setPan(100, -200);

    expect(camera.panX).toBe(100);
    expect(camera.panY).toBe(-200);
  });

  it("pans by world units independently of zoom", () => {
    const camera = new Camera({ panX: 100, panY: 200, zoom: 10 });

    camera.panBy(10, -20);

    expect(camera.panX).toBe(110);
    expect(camera.panY).toBe(180);
  });

  it("sets zoom while keeping the viewport origin fixed", () => {
    const camera = new Camera({ panX: 25, panY: -50 });

    camera.setZoom(4);

    expect(camera.panX).toBe(25);
    expect(camera.panY).toBe(-50);
    expect(camera.zoom).toBe(4);
    expect(camera.screenToWorld({ x: 80, y: 40 })).toEqual({ x: 45, y: -40 });
  });

  it("zooms around an arbitrary screen anchor without world-space drift", () => {
    const camera = new Camera({ panX: -100, panY: 50, zoom: 0.5 });
    const screenAnchor = { x: 500, y: 300 };
    const worldBefore = camera.screenToWorld(screenAnchor);

    camera.zoomAt(screenAnchor, 4);

    const worldAfter = camera.screenToWorld(screenAnchor);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    expect(camera.zoom).toBe(4);
    expect(camera.panX).toBeCloseTo(775);
    expect(camera.panY).toBeCloseTo(575);
  });
});

describe("Camera visible world rectangle", () => {
  it("returns the world region covered by the viewport", () => {
    const camera = new Camera({ panX: -100, panY: 50, zoom: 2 });

    expect(camera.visibleWorldRect({ width: 800, height: 600 })).toEqual({
      x: -100,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it("allows a zero-sized viewport", () => {
    const camera = new Camera({ panX: 10, panY: -20, zoom: 4 });

    expect(camera.visibleWorldRect({ width: 0, height: 0 })).toEqual({
      x: 10,
      y: -20,
      width: 0,
      height: 0,
    });
  });
});

describe("Camera input validation", () => {
  it.each([
    [{ panX: Number.NaN }, ErrorCodes.CAMERA.NON_FINITE_NUMBER],
    [{ panY: Number.POSITIVE_INFINITY }, ErrorCodes.CAMERA.NON_FINITE_NUMBER],
    [{ zoom: 0 }, ErrorCodes.CAMERA.INVALID_ZOOM],
    [{ zoom: -1 }, ErrorCodes.CAMERA.INVALID_ZOOM],
    [{ zoom: Number.NaN }, ErrorCodes.CAMERA.INVALID_ZOOM],
    [{ zoom: Number.NEGATIVE_INFINITY }, ErrorCodes.CAMERA.INVALID_ZOOM],
  ] as const)("rejects invalid constructor config %#", (config, errorCode) => {
    const createCamera = () => new Camera(config);

    expect(createCamera).toThrow(ReverieRangeError);
    expect(createCamera).toThrow(`[${errorCode}]`);
  });

  it("rejects non-number constructor values", () => {
    const createCamera = () =>
      new Camera({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        panX: "0",
      });

    expect(createCamera).toThrow(ReverieTypeError);
    expect(createCamera).toThrow(`[${ErrorCodes.CAMERA.INVALID_NUMBER_TYPE}]`);
  });

  it.each([
    [
      "screenToWorld",
      (camera: Camera) => camera.screenToWorld({ x: 0, y: Number.NaN }),
    ],
    [
      "worldToScreen",
      (camera: Camera) =>
        camera.worldToScreen({ x: Number.POSITIVE_INFINITY, y: 0 }),
    ],
  ] as const)("rejects non-finite points passed to %s", (_, operation) => {
    const camera = new Camera();

    expect(() => operation(camera)).toThrow(ReverieRangeError);
    expect(() => operation(camera)).toThrow(
      `[${ErrorCodes.CAMERA.NON_FINITE_NUMBER}]`,
    );
  });

  it("rejects non-number point components", () => {
    const camera = new Camera();
    const convertPoint = () =>
      camera.screenToWorld({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        x: "0",
        y: 0,
      });

    expect(convertPoint).toThrow(ReverieTypeError);
    expect(convertPoint).toThrow(`[${ErrorCodes.CAMERA.INVALID_NUMBER_TYPE}]`);
  });

  it("rejects non-number values passed to state update methods", () => {
    const camera = new Camera();

    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      camera.panBy("1", 0);
    }).toThrow(ReverieTypeError);
    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      camera.setZoom("2");
    }).toThrow(ReverieTypeError);
    expect(() => {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      camera.visibleWorldRect({ width: "100", height: 100 });
    }).toThrow(ReverieTypeError);
  });

  it("rejects a non-finite zoom anchor without changing state", () => {
    const camera = new Camera({ panX: 10, panY: 20, zoom: 2 });

    expect(() => camera.zoomAt({ x: Number.NaN, y: 50 }, 4)).toThrow(
      ReverieRangeError,
    );
    expect({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom }).toEqual(
      {
        panX: 10,
        panY: 20,
        zoom: 2,
      },
    );
  });

  it("keeps pan unchanged when a setPan update is rejected", () => {
    const camera = new Camera({ panX: 10, panY: 20 });

    expect(() => camera.setPan(30, Number.NaN)).toThrow(ReverieRangeError);
    expect(camera.panX).toBe(10);
    expect(camera.panY).toBe(20);
  });

  it("rejects a panBy update whose result overflows", () => {
    const camera = new Camera({ panX: Number.MAX_VALUE, panY: 20 });

    expect(() => camera.panBy(Number.MAX_VALUE, 10)).toThrow(ReverieRangeError);
    expect(camera.panX).toBe(Number.MAX_VALUE);
    expect(camera.panY).toBe(20);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects zoom update %s without changing state",
    (zoom) => {
      const camera = new Camera({ panX: 10, panY: 20, zoom: 2 });

      expect(() => camera.setZoom(zoom)).toThrow(ReverieRangeError);
      expect(() => camera.setZoom(zoom)).toThrow(
        `[${ErrorCodes.CAMERA.INVALID_ZOOM}]`,
      );
      expect(camera.zoom).toBe(2);
    },
  );

  it("keeps all camera state unchanged when zoomAt is rejected", () => {
    const camera = new Camera({ panX: 10, panY: 20, zoom: 2 });

    expect(() => camera.zoomAt({ x: 100, y: 50 }, 0)).toThrow(
      ReverieRangeError,
    );
    expect({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom }).toEqual(
      {
        panX: 10,
        panY: 20,
        zoom: 2,
      },
    );
  });

  it.each([
    [{ width: -1, height: 100 }, ErrorCodes.CAMERA.INVALID_VIEWPORT_SIZE],
    [{ width: 100, height: -1 }, ErrorCodes.CAMERA.INVALID_VIEWPORT_SIZE],
    [{ width: Number.NaN, height: 100 }, ErrorCodes.CAMERA.NON_FINITE_NUMBER],
    [
      { width: 100, height: Number.POSITIVE_INFINITY },
      ErrorCodes.CAMERA.NON_FINITE_NUMBER,
    ],
  ] as const)("rejects invalid viewport %#", (viewport, errorCode) => {
    const camera = new Camera();
    const getVisibleRect = () => camera.visibleWorldRect(viewport);

    expect(getVisibleRect).toThrow(ReverieRangeError);
    expect(getVisibleRect).toThrow(`[${errorCode}]`);
  });
});
