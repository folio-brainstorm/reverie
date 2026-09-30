import { describe, expect, it } from "vitest";

import { Camera, ErrorCodes, View, World } from "@reveriejs/core";
import { serializeDocument } from "@reveriejs/core/document";

const ANGLES = [
  0,
  Math.PI / 2,
  -Math.PI / 2,
  Math.PI,
  -Math.PI,
  2 * Math.PI,
  0.37,
];

describe("View projection", () => {
  it.each(ANGLES)(
    "round-trips continuous negative and fractional positions at angle %s",
    (rotation) => {
      const view = new View({ panX: -17.25, panY: 8.5, zoom: 2.75, rotation });
      for (const point of [
        { x: 0, y: 0 },
        { x: -12.75, y: 5.125 },
      ]) {
        const screen = view.worldToScreen(point);
        const world = view.screenToWorld(screen);
        expect(world.x).toBeCloseTo(point.x, 10);
        expect(world.y).toBeCloseTo(point.y, 10);
        const m = view.getTransform();
        expect(m.a * point.x + m.c * point.y + m.e).toBeCloseTo(screen.x, 10);
        expect(m.b * point.x + m.d * point.y + m.f).toBeCloseTo(screen.y, 10);
      }
      expect(view.rotation).toBe(rotation);
    },
  );

  it("turns positive angles clockwise in screen coordinates", () => {
    const view = new View({ rotation: Math.PI / 2 });
    expect(view.worldToScreen({ x: 1, y: 0 }).x).toBeCloseTo(0);
    expect(view.worldToScreen({ x: 1, y: 0 }).y).toBeCloseTo(1);
  });

  it.each(ANGLES)(
    "preserves zoom and rotation anchors and follows screen pan at angle %s",
    (rotation) => {
      const view = new View({ panX: -2, panY: 3, zoom: 0.7 });
      const anchor = { x: -10.5, y: 22.75 };
      const initial = view.screenToWorld(anchor);
      view.rotateAt(anchor, rotation);
      view.zoomAt(anchor, 3.125);
      expect(view.screenToWorld(anchor).x).toBeCloseTo(initial.x, 10);
      expect(view.screenToWorld(anchor).y).toBeCloseTo(initial.y, 10);
      view.panByScreen(-12, 7.25);
      const moved = view.worldToScreen(initial);
      expect(moved.x).toBeCloseTo(anchor.x - 12, 10);
      expect(moved.y).toBeCloseTo(anchor.y + 7.25, 10);
    },
  );

  it.each(ANGLES)(
    "bounds the ordered visible quadrilateral at angle %s",
    (rotation) => {
      const view = new View({ panX: -5, panY: -3, zoom: 2, rotation });
      const size = { width: 30, height: 20 };
      const quad = view.visibleWorldQuad(size);
      const bounds = view.visibleWorldBounds(size);
      const corners = [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
      ];
      quad.forEach((point, index) => {
        const screen = view.worldToScreen(point);
        const corner = corners[index];
        if (corner === undefined) throw new Error("Missing viewport corner");
        expect(screen.x).toBeCloseTo(corner.x);
        expect(screen.y).toBeCloseTo(corner.y);
        expect(point.x).toBeGreaterThanOrEqual(bounds.x - 1e-10);
        expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-10);
        expect(point.y).toBeGreaterThanOrEqual(bounds.y - 1e-10);
        expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-10);
      });
      expect(view.visibleWorldRect(size)).toEqual(bounds);
      expect(view.visibleWorldBounds({ width: 0, height: 0 })).toEqual({
        x: -5,
        y: -3,
        width: 0,
        height: 0,
      });
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "rejects invalid angle %s atomically",
    (rotation) => {
      const view = new View({ panX: 2, panY: -3, zoom: 4, rotation: 0.2 });
      const before = view.getTransform();
      expect(() => view.setRotation(rotation)).toThrow(
        ErrorCodes.VIEW.NON_FINITE_NUMBER,
      );
      expect(() => view.rotateAt({ x: 15, y: 20 }, rotation)).toThrow();
      expect(view.getTransform()).toEqual(before);
    },
  );

  it.each([0, -1, NaN, Infinity])(
    "rejects invalid zoom %s atomically",
    (zoom) => {
      const view = new View({ rotation: 0.4 });
      const before = view.getTransform();
      expect(() => view.zoomAt({ x: 5, y: 6 }, zoom)).toThrow(
        ErrorCodes.VIEW.INVALID_ZOOM,
      );
      expect(view.getTransform()).toEqual(before);
    },
  );

  it.each([
    { width: -1, height: 0 },
    { width: 0, height: -1 },
    { width: NaN, height: 1 },
    { width: 1, height: Infinity },
  ])("rejects invalid viewport %j", (size) => {
    expect(() => new View().visibleWorldQuad(size)).toThrow();
  });

  it("rejects coordinate and computed-pan failures without partial updates", () => {
    const view = new View({ panX: Number.MAX_VALUE, panY: 3, rotation: 0.5 });
    const before = view.getTransform();
    expect(() => view.panBy(Number.MAX_VALUE, 1)).toThrow();
    expect(() => view.panByScreen(Infinity, 2)).toThrow();
    expect(() => view.setPan(1, NaN)).toThrow();
    expect(() => view.rotateAt({ x: Infinity, y: 0 }, 1)).toThrow();
    expect(() => view.screenToWorld({ x: NaN, y: 0 })).toThrow();
    expect(() => view.worldToScreen({ x: 0, y: Infinity })).toThrow();
    expect(view.getTransform()).toEqual(before);
  });

  it("keeps legacy errors and independent views outside document state", () => {
    expect(new Camera()).toBeInstanceOf(View);
    expect(() => new Camera().setZoom(0)).toThrow(
      ErrorCodes.CAMERA.INVALID_ZOOM,
    );
    const world = new World({ tileSize: 4 });
    const before = serializeDocument(world);
    const first = new View();
    const second = new View();
    first.rotateAt({ x: 10, y: 10 }, 2);
    first.zoomAt({ x: 10, y: 10 }, 3);
    first.panByScreen(2, 3);
    expect(second.rotation).toBe(0);
    expect(second.panX).toBe(0);
    expect(serializeDocument(world)).toEqual(before);
  });
});

it.each(["bad", null, undefined])(
  "rejects non-numeric rotation %s",
  (rotation) => {
    const view = new View();
    expect(() => Reflect.apply(view.setRotation, view, [rotation])).toThrow(
      ErrorCodes.VIEW.INVALID_NUMBER_TYPE,
    );
    expect(view.rotation).toBe(0);
  },
);

it("does not partially commit anchored updates that overflow", () => {
  const view = new View({ panX: 2, panY: 3, zoom: 1 });
  const before = view.getTransform();
  expect(() =>
    view.zoomAt({ x: Number.MAX_VALUE, y: 1 }, Number.MIN_VALUE),
  ).toThrow();
  expect(view.getTransform()).toEqual(before);
  view.setZoom(Number.MIN_VALUE);
  const tiny = view.getTransform();
  expect(() => view.rotateAt({ x: 1, y: 1 }, Math.PI / 2)).toThrow();
  expect(view.getTransform()).toEqual(tiny);
});
