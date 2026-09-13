import type { StrokeConfig } from "../../interfaces/stroke/StrokeConfig.js";
import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { advanceStampPlacement } from "./AdvanceStampPlacement.js";

/**
 * Preserves raw input samples and places evenly spaced brush stamps along their
 * piecewise-linear world-space path.
 */
export class Stroke {
  /** Raster and brush remain fixed for the complete stroke lifetime. */
  private readonly config: StrokeConfig;

  /** Fixed world-space interval derived when the stroke is constructed. */
  private readonly stampDistance: number;

  /** Internally owned raw input facts in arrival order. */
  private readonly samples: StrokeSample[] = [];

  /** Most recently accepted sample, or null before input begins. */
  private lastSample: StrokeSample | null = null;

  /** Path length accumulated after the most recent brush stamp. */
  private distanceSinceLastStamp = 0;

  /** Whether this stroke refuses further samples. */
  private hasEnded = false;

  /** Returns defensive copies of every raw input sample in arrival order. */
  get rawSamples(): readonly StrokeSample[] {
    return this.samples.map(copySample);
  }

  /** Returns whether {@link end} has closed this stroke to further input. */
  get isEnded(): boolean {
    return this.hasEnded;
  }

  /**
   * Creates an empty stroke using a fixed raster, brush, and stamp interval.
   *
   * @param config - Raster receiving stamps and brush defining size and spacing.
   * @throws {ReverieRangeError} Brush size and spacing do not produce a positive,
   * finite stamp distance.
   */
  constructor(config: StrokeConfig) {
    const stampDistance = config.brush.size * config.brush.spacing;

    if (!Number.isFinite(stampDistance) || stampDistance <= 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.INVALID_STAMP_DISTANCE,
        {
          size: config.brush.size,
          spacing: config.brush.spacing,
        },
      );
    }

    this.config = { ...config };
    this.stampDistance = stampDistance;
  }

  /**
   * Saves one raw sample and advances stamp placement along a linear segment.
   *
   * The first sample stamps immediately. Later samples carry unused distance
   * across segment boundaries, so input sampling frequency does not reset
   * brush spacing.
   *
   * @param sample - Continuous position and monotonically non-decreasing time.
   * @throws {ReverieError} The stroke has already ended.
   * @throws {ReverieTypeError} A position component or timestamp is not a number.
   * @throws {ReverieRangeError} A value is not finite or timestamp order regresses.
   */
  addSample(sample: StrokeSample): void {
    if (this.hasEnded) {
      throw ReverieError.from(ErrorDefinitions.STROKE.ALREADY_ENDED);
    }

    this.assertValidSample(sample);

    const ownedSample = copySample(sample);
    const previousSample = this.lastSample;

    if (previousSample !== null) {
      const segmentLength = Math.hypot(
        ownedSample.position.x - previousSample.position.x,
        ownedSample.position.y - previousSample.position.y,
      );

      if (!Number.isFinite(segmentLength)) {
        throw ReverieRangeError.from(
          ErrorDefinitions.STROKE.NON_FINITE_SEGMENT,
        );
      }
    }

    this.samples.push(ownedSample);
    this.lastSample = ownedSample;

    if (previousSample === null) {
      this.config.brush.stamp(this.config.raster, ownedSample.position);
      this.distanceSinceLastStamp = 0;
      return;
    }

    this.distanceSinceLastStamp = advanceStampPlacement(
      previousSample.position,
      ownedSample.position,
      this.stampDistance,
      this.distanceSinceLastStamp,
      (position) => this.config.brush.stamp(this.config.raster, position),
    );
  }

  /** Marks this stroke as ended; repeated calls have no additional effect. */
  end(): void {
    this.hasEnded = true;
  }

  /** Rejects malformed, non-finite, or temporally regressive input samples. */
  private assertValidSample(sample: StrokeSample): void {
    Stroke.assertNumber(sample.position.x, "sample.position.x");
    Stroke.assertNumber(sample.position.y, "sample.position.y");
    Stroke.assertNumber(sample.timestamp, "sample.timestamp");

    if (!Number.isFinite(sample.position.x)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.NON_FINITE_POSITION,
        { param: "position.x", received: sample.position.x },
      );
    }

    if (!Number.isFinite(sample.position.y)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.NON_FINITE_POSITION,
        { param: "position.y", received: sample.position.y },
      );
    }

    if (!Number.isFinite(sample.timestamp)) {
      throw ReverieRangeError.from(ErrorDefinitions.STROKE.INVALID_TIMESTAMP, {
        received: sample.timestamp,
      });
    }

    if (
      this.lastSample !== null &&
      sample.timestamp < this.lastSample.timestamp
    ) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.NON_MONOTONIC_TIMESTAMP,
        {
          previous: this.lastSample.timestamp,
          received: sample.timestamp,
        },
      );
    }
  }

  /** Rejects a non-number before finite and ordering comparisons. */
  private static assertNumber(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(ErrorDefinitions.STROKE.INVALID_NUMBER_TYPE, {
        param: parameterName,
        received: typeof value,
      });
    }
  }
}

/** Copies nested position data so raw samples cannot be changed by callers. */
function copySample(sample: StrokeSample): StrokeSample {
  return {
    position: { ...sample.position },
    timestamp: sample.timestamp,
  };
}
