import type { Brush } from "../../interfaces/brush/Brush.js";
import type { CircleBrushConfig } from "../../interfaces/brush/CircleBrushConfig.js";
import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushDynamics } from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";
import type { NormalizedBrushScatter } from "../../interfaces/brush/scatter/NormalizedBrushScatter.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { Raster } from "../raster/Raster.js";

import { blendRasterPixelSourceOver } from "../../internal/raster-write/BlendRasterPixelSourceOver.js";
import { rasterizeCirclePixels } from "../../internal/rasterizer/RasterizeCirclePixels.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { assertFiniteCircleCenterComponent } from "../../utils/number/math/AssertFiniteCircleCenterComponent.js";
import { isPositiveFiniteNumber } from "../../utils/number/math/IsPositiveFiniteNumber.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { normalizeBrushDynamics } from "./NormalizeBrushDynamics.js";
import { normalizeBrushJitter } from "./NormalizeBrushJitter.js";
import { normalizeBrushScatter } from "./NormalizeBrushScatter.js";
import { resolveBrushDynamics } from "./ResolveBrushDynamics.js";
import { resolveBrushJitter } from "./ResolveBrushJitter.js";
import { resolveBrushScatter } from "./ResolveBrushScatter.js";

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

  /** Static rotation offset in radians. */
  readonly rotation: number;

  /** Stable uint32 base seed for stroke derivation and direct stamps. */
  readonly seed: number;

  /** Internally owned color so later config mutations cannot alter the brush. */
  private readonly internalColor: RGBAColor;

  /** Effective binary-coverage alpha reused by every trusted pixel write. */
  private readonly effectiveAlpha: number;

  /** Normalized effective alpha reused by Source Over arithmetic. */
  private readonly normalizedEffectiveAlpha: number;

  /** Validated dynamics owned by this brush, or `null` for the legacy path. */
  private readonly dynamics: NormalizedBrushDynamics | null;

  /** Validated optional variation applied after dynamics. */
  private readonly jitter: NormalizedBrushJitter | null;

  /** Validated optional final-position variation. */
  private readonly scatter: NormalizedBrushScatter | null;

  /** Whether dynamics, jitter, or scatter requires per-stamp resolution. */
  private readonly hasPaintVariation: boolean;

  /** Returns a copy of the straight-alpha RGBA8 stamp color. */
  get color(): RGBAColor {
    return { ...this.internalColor };
  }

  /**
   * Creates a circular brush with validated, immutable stamp parameters.
   *
   * @param config - Base paint parameters, dynamics, uint32 seed, jitter, and scatter.
   * @throws {ReverieRangeError} Size or spacing is not positive and finite,
   * opacity is outside the inclusive `0..1` range, rotation is not finite,
   * color is not valid RGBA8, a dynamics/jitter/scatter mapping is malformed, or seed
   * is outside the uint32 range.
   */
  constructor(config: CircleBrushConfig) {
    const {
      size,
      color,
      opacity = 1,
      spacing = DEFAULT_BRUSH_SPACING,
      rotation = 0,
      seed = 0,
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

    if (typeof rotation !== "number" || !Number.isFinite(rotation)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_ROTATION);
    }

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    assertUint32(seed, "brush.seed");

    this.size = size;
    this.opacity = opacity;
    this.spacing = spacing;
    this.rotation = rotation;
    this.seed = seed >>> 0;
    this.internalColor = { ...color };
    this.effectiveAlpha = Math.round(color.a * opacity);
    this.normalizedEffectiveAlpha = this.effectiveAlpha / 255;
    this.dynamics = normalizeBrushDynamics(config.dynamics);
    this.jitter = normalizeBrushJitter(config.jitter);
    this.scatter = normalizeBrushScatter(config.scatter);
    this.hasPaintVariation =
      this.jitter !== null ||
      this.scatter !== null ||
      (this.dynamics !== null &&
        (this.dynamics.size.pressure !== null ||
          this.dynamics.size.velocity !== null ||
          this.dynamics.opacity.pressure !== null ||
          this.dynamics.opacity.velocity !== null));
  }

  /**
   * Resolves dynamics and deterministic jitter for one actual stamp.
   *
   * @param input - Optional dynamics input with uint32 seed and stamp index;
   * omitted input uses neutral dynamics defaults, the brush seed, and index `0`.
   * @returns Independent size, opacity, and radian rotation values.
   * @throws {ReverieRangeError} Used input, identity, curve output, or jitter result
   * is invalid.
   */
  resolveParameters(input?: StampCommand): ResolvedBrushParameters {
    return resolveBrushJitter(
      resolveBrushDynamics(
        this.size,
        this.opacity,
        this.rotation,
        this.dynamics,
        input,
      ),
      this.jitter,
      this.seed,
      input,
    );
  }

  /**
   * Rasterizes and paints one circular stamp centered at a world position.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Continuous world-space center of the stamp.
   * @param input - Optional dynamics and random context; absent random identity
   * uses the brush seed and stamp index `0` without invocation state.
   * @throws {ReverieTypeError} A position component is not a number.
   * @throws {ReverieRangeError} A position is not finite or the resulting
   * pixel bounds exceed the safe integer range, or used dynamics input or curve
   * output, random identity, jitter arithmetic, or scatter result is invalid.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void {
    if (!this.hasPaintVariation) {
      this.paintCircle(
        raster,
        position,
        this.size,
        this.effectiveAlpha,
        this.normalizedEffectiveAlpha,
      );
      return;
    }

    const resolved = this.resolveParameters(input);

    if (resolved.size <= 0 || resolved.opacity <= 0) {
      return;
    }
    const effectiveAlpha = Math.round(this.internalColor.a * resolved.opacity);
    assertFiniteCircleCenterComponent(position.x, "center.x");
    assertFiniteCircleCenterComponent(position.y, "center.y");
    const paintPosition = resolveBrushScatter(
      position,
      resolved,
      this.scatter,
      this.seed,
      input,
    );

    this.paintCircle(
      raster,
      paintPosition,
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
