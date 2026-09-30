import type { ViewTransform } from "../../interfaces/view/ViewTransform.js";
import type { WorldQuad } from "../../interfaces/view/WorldQuad.js";
import type { ViewConfig } from "../../interfaces/view/ViewConfig.js";
import type { ScreenPoint } from "../../interfaces/camera/ScreenPoint.js";
import type { ViewportSize } from "../../interfaces/camera/ViewportSize.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { WorldRect } from "../../interfaces/camera/WorldRect.js";

import { defaultCameraConfig } from "../../config/camera/DefaultCameraConfig.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";

/**
 * Models a rotated view of continuous world space and converts positions
 * between world and screen coordinates.
 *
 * The pan values identify the world position at screen coordinate `(0, 0)`,
 * while zoom identifies the number of screen pixels per world unit.
 */
export class View {
  private _panX: number = defaultCameraConfig.panX;
  private _panY: number = defaultCameraConfig.panY;
  private _rotation = 0;

  /** Clockwise angle in radians, without normalization. */
  get rotation(): number {
    return this._rotation;
  }

  private errorDefinitions:
    typeof ErrorDefinitions.VIEW | typeof ErrorDefinitions.CAMERA =
    ErrorDefinitions.VIEW;

  /** Selects legacy boundary errors before a Camera applies its initial state. */
  protected useCameraErrors(): void {
    this.errorDefinitions = ErrorDefinitions.CAMERA;
  }

  private _zoom: number = defaultCameraConfig.zoom;

  /** World-space X coordinate at the screen origin. */
  get panX(): number {
    return this._panX;
  }

  /** World-space Y coordinate at the screen origin. */
  get panY(): number {
    return this._panY;
  }

  /** Number of screen pixels represented by one world unit. */
  get zoom(): number {
    return this._zoom;
  }

  /**
   * Creates a view with optional pan, zoom and clockwise rotation overrides.
   *
   * @param config - Initial view state. Omitted values default to pan `(0, 0)`
   * zoom `1`, and rotation `0`.
   * @throws {ReverieTypeError} A supplied value is not a number.
   * @throws {ReverieRangeError} A pan is not finite or zoom is not positive and finite.
   */
  constructor(config: ViewConfig = {}) {
    const {
      panX = defaultCameraConfig.panX,
      panY = defaultCameraConfig.panY,
      zoom = defaultCameraConfig.zoom,
    } = config;

    this.setPan(panX, panY);
    this.setZoom(zoom);
    this.setRotation(config.rotation === undefined ? 0 : config.rotation);
  }

  /**
   * Converts a continuous screen-space position into world space without
   * rounding or pixel quantization.
   *
   * @param point - Position measured from the viewport's top-left corner.
   * @returns The corresponding continuous world-space position.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not finite.
   */
  screenToWorld(point: ScreenPoint): WorldPoint {
    this.assertFiniteNumber(point.x, "screenPoint.x");
    this.assertFiniteNumber(point.y, "screenPoint.y");

    return {
      x:
        this._panX +
        (Math.cos(this._rotation) * point.x +
          Math.sin(this._rotation) * point.y) /
          this._zoom,
      y:
        this._panY +
        (-Math.sin(this._rotation) * point.x +
          Math.cos(this._rotation) * point.y) /
          this._zoom,
    };
  }

  /**
   * Converts a continuous world-space position into screen space without
   * rounding or pixel quantization.
   *
   * @param point - Continuous position in world space.
   * @returns The corresponding screen position relative to the viewport origin.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not finite.
   */
  worldToScreen(point: WorldPoint): ScreenPoint {
    this.assertFiniteNumber(point.x, "worldPoint.x");
    this.assertFiniteNumber(point.y, "worldPoint.y");

    return {
      x:
        ((point.x - this._panX) * Math.cos(this._rotation) -
          (point.y - this._panY) * Math.sin(this._rotation)) *
        this._zoom,
      y:
        ((point.x - this._panX) * Math.sin(this._rotation) +
          (point.y - this._panY) * Math.cos(this._rotation)) *
        this._zoom,
    };
  }

  /**
   * Repositions the viewport origin in world space.
   *
   * @param x - World-space X coordinate to show at the viewport's left edge.
   * @param y - World-space Y coordinate to show at the viewport's top edge.
   * @throws {ReverieTypeError} A pan component is not a number.
   * @throws {ReverieRangeError} A pan component is not finite.
   */
  setPan(x: number, y: number): void {
    this.assertFiniteNumber(x, "panX");
    this.assertFiniteNumber(y, "panY");

    this._panX = x;
    this._panY = y;
  }

  /**
   * Moves the viewport origin by a displacement measured in world units.
   *
   * @param dx - Horizontal world-space displacement.
   * @param dy - Vertical world-space displacement.
   * @throws {ReverieTypeError} A displacement component is not a number.
   * @throws {ReverieRangeError} A displacement or resulting pan is not finite.
   */
  panBy(dx: number, dy: number): void {
    this.assertFiniteNumber(dx, "dx");
    this.assertFiniteNumber(dy, "dy");

    const panX = this._panX + dx;
    const panY = this._panY + dy;

    this.setPan(panX, panY);
  }

  /**
   * Sets the number of screen pixels represented by one world unit.
   *
   * Changing zoom this way keeps the screen origin fixed. Use {@link zoomAt}
   * when a different screen-space anchor must remain stationary.
   *
   * @param zoom - Positive, finite screen pixels per world unit.
   * @throws {ReverieTypeError} The zoom is not a number.
   * @throws {ReverieRangeError} The zoom is not positive and finite.
   */
  setZoom(zoom: number): void {
    this.assertValidZoom(zoom);
    this._zoom = zoom;
  }

  /**
   * Changes zoom while preserving the world position beneath a screen point.
   *
   * @param screenPoint - Screen-space anchor that must remain stationary.
   * @param zoom - Positive, finite screen pixels per world unit.
   * @throws {ReverieTypeError} The zoom or an anchor component is not a number.
   * @throws {ReverieRangeError} The zoom is invalid, an anchor is not finite, or
   * the resulting pan exceeds the finite numeric range.
   */
  zoomAt(screenPoint: ScreenPoint, zoom: number): void {
    const worldAnchor = this.screenToWorld(screenPoint);
    this.assertValidZoom(zoom);

    const panX =
      worldAnchor.x -
      (Math.cos(this._rotation) * screenPoint.x +
        Math.sin(this._rotation) * screenPoint.y) /
        zoom;
    const panY =
      worldAnchor.y -
      (-Math.sin(this._rotation) * screenPoint.x +
        Math.cos(this._rotation) * screenPoint.y) /
        zoom;

    this.assertFiniteNumber(panX, "panX");
    this.assertFiniteNumber(panY, "panY");

    this._zoom = zoom;
    this._panX = panX;
    this._panY = panY;
  }

  /**
   * Calculates the continuous world-space rectangle covered by a viewport.
   *
   * Zero width and height are valid, which supports views that have not yet
   * completed layout.
   *
   * @param viewport - Non-negative, finite dimensions in screen pixels.
   * @returns Axis-aligned bounds of the visible world quadrilateral.
   * @throws {ReverieTypeError} A viewport dimension is not a number.
   * @throws {ReverieRangeError} A viewport dimension is negative or not finite.
   */
  visibleWorldRect(viewport: ViewportSize): WorldRect {
    return this.visibleWorldBounds(viewport);
  }

  /** Returns viewport corners in world space, ordered top-left clockwise.
   * @param viewport - Non-negative finite CSS pixel dimensions.
   * @returns Four continuous world positions.
   * @throws {ReverieTypeError} A viewport dimension is not a number.
   * @throws {ReverieRangeError} A viewport dimension is negative or non-finite.
   */
  visibleWorldQuad(viewport: ViewportSize): WorldQuad {
    this.assertValidViewportDimension(viewport.width, "width");
    this.assertValidViewportDimension(viewport.height, "height");
    return [
      this.screenToWorld({ x: 0, y: 0 }),
      this.screenToWorld({ x: viewport.width, y: 0 }),
      this.screenToWorld({ x: viewport.width, y: viewport.height }),
      this.screenToWorld({ x: 0, y: viewport.height }),
    ];
  }

  /** Returns the axis-aligned bounds of all visible world corners.
   * @param viewport - Non-negative finite CSS pixel dimensions.
   * @returns World-space bounding rectangle.
   * @throws {ReverieTypeError} A viewport dimension is not a number.
   * @throws {ReverieRangeError} A viewport dimension is negative or non-finite.
   */
  visibleWorldBounds(viewport: ViewportSize): WorldRect {
    const quad = this.visibleWorldQuad(viewport);
    if (this._rotation === 0)
      return {
        x: this._panX,
        y: this._panY,
        width: viewport.width / this._zoom,
        height: viewport.height / this._zoom,
      };
    const x = Math.min(...quad.map((point) => point.x));
    const y = Math.min(...quad.map((point) => point.y));
    return {
      x,
      y,
      width: Math.max(...quad.map((point) => point.x)) - x,
      height: Math.max(...quad.map((point) => point.y)) - y,
    };
  }

  /** Moves the image with a screen-space pointer displacement.
   * @param dx - Horizontal CSS pixel displacement.
   * @param dy - Vertical CSS pixel displacement.
   * @throws {ReverieTypeError} A displacement is not a number.
   * @throws {ReverieRangeError} A displacement or resulting pan is non-finite.
   */
  panByScreen(dx: number, dy: number): void {
    this.assertFiniteNumber(dx, "dx");
    this.assertFiniteNumber(dy, "dy");
    this.panBy(
      -(Math.cos(this._rotation) * dx + Math.sin(this._rotation) * dy) /
        this._zoom,
      -(-Math.sin(this._rotation) * dx + Math.cos(this._rotation) * dy) /
        this._zoom,
    );
  }

  /** Sets the absolute clockwise angle while keeping the screen origin fixed.
   * @param rotation - Finite angle in radians.
   * @throws {ReverieTypeError} The angle is not a number.
   * @throws {ReverieRangeError} The angle is not finite.
   */
  setRotation(rotation: number): void {
    this.assertFiniteNumber(rotation, "rotation");
    this._rotation = rotation;
  }

  /** Sets an absolute angle without moving the world point beneath the anchor.
   * @param anchor - Stationary CSS pixel position.
   * @param rotation - Finite clockwise angle in radians.
   * @throws {ReverieTypeError} The angle or an anchor component is not a number.
   * @throws {ReverieRangeError} The angle, anchor or resulting pan is not finite.
   */
  rotateAt(anchor: ScreenPoint, rotation: number): void {
    const world = this.screenToWorld(anchor);
    this.assertFiniteNumber(rotation, "rotation");
    const x =
      world.x -
      (Math.cos(rotation) * anchor.x + Math.sin(rotation) * anchor.y) /
        this._zoom;
    const y =
      world.y -
      (-Math.sin(rotation) * anchor.x + Math.cos(rotation) * anchor.y) /
        this._zoom;
    this.assertFiniteNumber(x, "panX");
    this.assertFiniteNumber(y, "panY");
    this._panX = x;
    this._panY = y;
    this._rotation = rotation;
  }

  /** Returns Canvas/SVG/CSS affine world-to-screen coefficients.
   * @returns Matrix coefficients in CSS pixels, independent of DPR.
   * @example
   * const { a, b, c, d, e, f } = view.getTransform();
   * context.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
   */
  getTransform(): ViewTransform {
    const a = this._zoom * Math.cos(this._rotation);
    const b = this._zoom * Math.sin(this._rotation);
    return {
      a,
      b,
      c: -b,
      d: a,
      e: -a * this._panX + b * this._panY,
      f: -b * this._panX - a * this._panY,
    };
  }

  /** Validates a number used at a public View boundary. */
  private assertFiniteNumber(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(this.errorDefinitions.INVALID_NUMBER_TYPE, {
        param: parameterName,
        received: typeof value,
      });
    }

    if (!Number.isFinite(value)) {
      throw ReverieRangeError.from(this.errorDefinitions.NON_FINITE_NUMBER, {
        param: parameterName,
        received: value,
      });
    }
  }

  /** Validates zoom independently so a rejected update cannot mutate state. */
  private assertValidZoom(zoom: unknown): asserts zoom is number {
    if (typeof zoom !== "number") {
      throw ReverieTypeError.from(this.errorDefinitions.INVALID_NUMBER_TYPE, {
        param: "zoom",
        received: typeof zoom,
      });
    }

    if (!Number.isFinite(zoom) || zoom <= 0) {
      throw ReverieRangeError.from(this.errorDefinitions.INVALID_ZOOM);
    }
  }

  /** Validates one viewport dimension, including its non-negative constraint. */
  private assertValidViewportDimension(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    this.assertFiniteNumber(value, `viewport.${parameterName}`);

    if (value < 0) {
      throw ReverieRangeError.from(
        this.errorDefinitions.INVALID_VIEWPORT_SIZE,
        {
          param: parameterName,
          received: value,
        },
      );
    }
  }
}
