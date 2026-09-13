import type { CameraConfig } from "../../interfaces/camera/CameraConfig.js";
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
 * Models an axis-aligned view of continuous world space and converts positions
 * between world and screen coordinates.
 *
 * The pan values identify the world position at screen coordinate `(0, 0)`,
 * while zoom identifies the number of screen pixels per world unit.
 */
export class Camera {
  private _panX: number = defaultCameraConfig.panX;
  private _panY: number = defaultCameraConfig.panY;
  private _zoom: number = defaultCameraConfig.zoom;

  /** World-space X coordinate visible at the viewport's left edge. */
  get panX(): number {
    return this._panX;
  }

  /** World-space Y coordinate visible at the viewport's top edge. */
  get panY(): number {
    return this._panY;
  }

  /** Number of screen pixels represented by one world unit. */
  get zoom(): number {
    return this._zoom;
  }

  /**
   * Creates a camera with optional pan and zoom overrides.
   *
   * @param config - Initial camera state. Omitted values default to pan `(0, 0)`
   * and zoom `1`.
   * @throws {ReverieTypeError} A supplied value is not a number.
   * @throws {ReverieRangeError} A pan is not finite or zoom is not positive and finite.
   */
  constructor(config: CameraConfig = {}) {
    const {
      panX = defaultCameraConfig.panX,
      panY = defaultCameraConfig.panY,
      zoom = defaultCameraConfig.zoom,
    } = config;

    this.setPan(panX, panY);
    this.setZoom(zoom);
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
    Camera.assertFiniteNumber(point.x, "screenPoint.x");
    Camera.assertFiniteNumber(point.y, "screenPoint.y");

    return {
      x: this._panX + point.x / this._zoom,
      y: this._panY + point.y / this._zoom,
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
    Camera.assertFiniteNumber(point.x, "worldPoint.x");
    Camera.assertFiniteNumber(point.y, "worldPoint.y");

    return {
      x: (point.x - this._panX) * this._zoom,
      y: (point.y - this._panY) * this._zoom,
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
    Camera.assertFiniteNumber(x, "panX");
    Camera.assertFiniteNumber(y, "panY");

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
    Camera.assertFiniteNumber(dx, "dx");
    Camera.assertFiniteNumber(dy, "dy");

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
    Camera.assertValidZoom(zoom);
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
    Camera.assertValidZoom(zoom);

    const panX = worldAnchor.x - screenPoint.x / zoom;
    const panY = worldAnchor.y - screenPoint.y / zoom;

    Camera.assertFiniteNumber(panX, "panX");
    Camera.assertFiniteNumber(panY, "panY");

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
   * @returns Visible world rectangle whose origin equals the current pan.
   * @throws {ReverieTypeError} A viewport dimension is not a number.
   * @throws {ReverieRangeError} A viewport dimension is negative or not finite.
   */
  visibleWorldRect(viewport: ViewportSize): WorldRect {
    Camera.assertValidViewportDimension(viewport.width, "width");
    Camera.assertValidViewportDimension(viewport.height, "height");

    return {
      x: this._panX,
      y: this._panY,
      width: viewport.width / this._zoom,
      height: viewport.height / this._zoom,
    };
  }

  /** Validates a number used at a public Camera boundary. */
  private static assertFiniteNumber(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(ErrorDefinitions.CAMERA.INVALID_NUMBER_TYPE, {
        param: parameterName,
        received: typeof value,
      });
    }

    if (!Number.isFinite(value)) {
      throw ReverieRangeError.from(ErrorDefinitions.CAMERA.NON_FINITE_NUMBER, {
        param: parameterName,
        received: value,
      });
    }
  }

  /** Validates zoom independently so a rejected update cannot mutate state. */
  private static assertValidZoom(zoom: unknown): asserts zoom is number {
    if (typeof zoom !== "number") {
      throw ReverieTypeError.from(ErrorDefinitions.CAMERA.INVALID_NUMBER_TYPE, {
        param: "zoom",
        received: typeof zoom,
      });
    }

    if (!Number.isFinite(zoom) || zoom <= 0) {
      throw ReverieRangeError.from(ErrorDefinitions.CAMERA.INVALID_ZOOM);
    }
  }

  /** Validates one viewport dimension, including its non-negative constraint. */
  private static assertValidViewportDimension(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    Camera.assertFiniteNumber(value, `viewport.${parameterName}`);

    if (value < 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.CAMERA.INVALID_VIEWPORT_SIZE,
        {
          param: parameterName,
          received: value,
        },
      );
    }
  }
}
