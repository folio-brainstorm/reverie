import type { Brush } from "../../interfaces/brush/Brush.js";
import type { CircleBrushConfig } from "../../interfaces/brush/CircleBrushConfig.js";
import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushDynamics } from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { Raster } from "../raster/Raster.js";

import { blendRasterPixelSourceOver } from "../../internal/raster-write/BlendRasterPixelSourceOver.js";
import { rasterizeCirclePixels } from "../../internal/rasterizer/RasterizeCirclePixels.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { isPositiveFiniteNumber } from "../../utils/number/math/IsPositiveFiniteNumber.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { normalizeBrushDynamics } from "./NormalizeBrushDynamics.js";
import { resolveBrushDynamics } from "./ResolveBrushDynamics.js";

const DEFAULT_BRUSH_SPACING = 0.25;

/**
 * Models a circular brush whose immutable parameters are applied to each stamp.
 *
 * The brush works exclusively in continuous world space. Rasterization,
 * coverage, alpha compositing, storage, and rendering remain delegated to
 * their respective layers.
 */
export class CircleBrush implements Brush {
  /** Stamp diameter measured in world units. */
  readonly size: number;

  /** Stamp opacity in the inclusive range from zero to one. */
  readonly opacity: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /** Internally owned color so later config mutations cannot alter the brush. */
  private readonly internalColor: RGBAColor;

  /** Effective binary-coverage alpha reused by every trusted pixel write. */
  private readonly effectiveAlpha: number;

  /** Normalized effective alpha reused by Source Over arithmetic. */
  private readonly normalizedEffectiveAlpha: number;

  /** Validated dynamics owned by this brush, or `null` for the legacy path. */
  private readonly dynamics: NormalizedBrushDynamics | null;

  /** Whether size or opacity input requires per-stamp paint parameters. */
  private readonly hasPaintDynamics: boolean;

  /** Returns a copy of the straight-alpha RGBA8 stamp color. */
  get color(): RGBAColor {
    return { ...this.internalColor };
  }

  /**
   * Creates a circular brush with validated, immutable stamp parameters.
   *
   * @param config - Diameter, RGBA8 color, opacity, spacing, and dynamics.
   * @throws {ReverieRangeError} Size or spacing is not positive and finite,
   * opacity is outside the inclusive `0..1` range, color is not valid RGBA8,
   * or a dynamics mapping is malformed.
   */
  constructor(config: CircleBrushConfig) {
    const {
      size,
      color,
      opacity = 1,
      spacing = DEFAULT_BRUSH_SPACING,
    } = config;

    if (!isPositiveFiniteNumber(size)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_SIZE);
    }

    if (!isUnitInterval(opacity)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_OPACITY);
    }

    if (!isPositiveFiniteNumber(spacing)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_SPACING);
    }

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    this.size = size;
    this.opacity = opacity;
    this.spacing = spacing;
    this.internalColor = { ...color };
    this.effectiveAlpha = Math.round(color.a * opacity);
    this.normalizedEffectiveAlpha = this.effectiveAlpha / 255;
    this.dynamics = normalizeBrushDynamics(config.dynamics);
    this.hasPaintDynamics =
      this.dynamics !== null &&
      (this.dynamics.size.pressure !== null ||
        this.dynamics.size.velocity !== null ||
        this.dynamics.opacity.pressure !== null ||
        this.dynamics.opacity.velocity !== null);
  }

  /**
   * Resolves this brush's immutable base values for one actual stamp.
   *
   * @param input - Stamp input carrying pressure, velocity, and tilt.
   * @returns Independent size, opacity, and radian rotation values.
   * @throws {ReverieRangeError} Used input or a custom curve result is invalid.
   */
  resolveParameters(input: StampCommand): ResolvedBrushParameters {
    return resolveBrushDynamics(this.size, this.opacity, this.dynamics, input);
  }

  /**
   * Rasterizes and paints one circular stamp centered at a world position.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Continuous world-space center of the stamp.
   * @param input - Optional input context for this actual stamp.
   * @throws {ReverieTypeError} A position component is not a number.
   * @throws {ReverieRangeError} A position is not finite or the resulting
   * pixel bounds exceed the safe integer range, or used dynamics input or curve
   * output is invalid.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void {
    if (!this.hasPaintDynamics) {
      this.paintCircle(
        raster,
        position,
        this.size,
        this.effectiveAlpha,
        this.normalizedEffectiveAlpha,
      );
      return;
    }

    const resolved = resolveBrushDynamics(
      this.size,
      this.opacity,
      this.dynamics,
      input,
    );
    const effectiveAlpha = Math.round(this.internalColor.a * resolved.opacity);

    this.paintCircle(
      raster,
      position,
      resolved.size,
      effectiveAlpha,
      effectiveAlpha / 255,
    );
  }

  /** Rasterizes one resolved circle through the existing trusted write path. */
  private paintCircle(
    raster: Raster,
    position: WorldPoint,
    size: number,
    effectiveAlpha: number,
    normalizedEffectiveAlpha: number,
  ): void {
    rasterizeCirclePixels(
      {
        center: position,
        radius: size / 2,
      },
      (x, y) => {
        if (size === 0 || effectiveAlpha === 0) {
          return;
        }

        blendRasterPixelSourceOver(
          raster,
          x,
          y,
          this.internalColor.r,
          this.internalColor.g,
          this.internalColor.b,
          effectiveAlpha,
          normalizedEffectiveAlpha,
        );
      },
    );
  }
}
