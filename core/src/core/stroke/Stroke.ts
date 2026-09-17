import type { Brush } from "../../interfaces/brush/Brush.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { StrokeConfig } from "../../interfaces/stroke/StrokeConfig.js";
import type { StrokeSample } from "../../interfaces/stroke/StrokeSample.js";
import type { StrokeSampleInput } from "../../interfaces/stroke/StrokeSampleInput.js";

import {
  MAX_TILT_DEGREES,
  MIN_TILT_DEGREES,
} from "../../config/stroke/StrokeInputConstants.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { deriveStrokeSeed } from "../../utils/random/DeriveStrokeSeed.js";
import { advanceStampPlacement } from "./AdvanceStampPlacement.js";
import { copyStrokeSample } from "./CopyStrokeSample.js";
import { deriveStampDirection } from "./DeriveStampDirection.js";
import { deriveStampVelocity } from "./DeriveStampVelocity.js";
import { normalizeStrokeSample } from "./NormalizeStrokeSample.js";
import { smoothStrokeSample } from "./SmoothStrokeSample.js";
import { StrokeResampler } from "./StrokeResampler.js";

/** Minimum consumed prefix before the queue considers reclaiming its storage. */
const PENDING_QUEUE_COMPACTION_THRESHOLD = 1024;

/** Core default that preserves raw positions unless smoothing is requested. */
const DEFAULT_SMOOTHING = 1;

/** Core default path-representation interval measured in world units. */
const DEFAULT_RESAMPLE_DISTANCE = 1;

/**
 * Preserves raw input, derives a smoothed and resampled path, and queues evenly
 * spaced stamp commands along that processed world-space path.
 *
 * Input attributes beyond position and time, meaning pressure and both tilt
 * axes, are normalized at the boundary and carried unchanged through smoothing,
 * resampling, and stamp placement. This class only transports those attributes;
 * interpreting them is left to a later step.
 */
export class Stroke {
  /** Brush whose fixed metrics place stamps and whose behavior consumers execute. */
  readonly brush: Brush;

  /** Final serializable uint32 seed, restorable independently of stroke sequence. */
  readonly strokeSeed: number;

  /** Next emission identity; queue consumption and compaction never reset it. */
  private nextStampIndex = 0;

  /** Position EMA factor captured for the lifetime of the stroke. */
  private readonly smoothing: number;

  /** Streaming fixed-distance processed-path generator. */
  private readonly resampler: StrokeResampler;

  /** Fixed world-space interval derived when the stroke is constructed. */
  private readonly stampDistance: number;

  /** Internally owned raw input facts in arrival order. */
  private readonly rawSampleStorage: StrokeSample[] = [];

  /** Internally owned derived path samples in emission order. */
  private readonly processedSampleStorage: StrokeSample[] = [];

  /** Stamp commands appended in path order and retained until consumed. */
  private pendingStamps: StampCommand[] = [];

  /** Index of the next unread command, avoiding linear-time array shifts. */
  private pendingReadIndex = 0;

  /** Most recently accepted raw sample, or null before input begins. */
  private lastRawSample: StrokeSample | null = null;

  /** Most recent EMA output used by the next smoothing step. */
  private lastSmoothedSample: StrokeSample | null = null;

  /** Most recent resampler output consumed by stamp placement. */
  private lastProcessedSample: StrokeSample | null = null;

  /** Path length accumulated after the most recent brush stamp. */
  private distanceSinceLastStamp = 0;

  /** Most recent actual stamp used to derive stroke-local motion. */
  private lastStampSample: StrokeSample | null = null;

  /** Whether this stroke refuses further samples. */
  private hasEnded = false;

  /** Returns defensive copies of every raw input sample in arrival order. */
  get rawSamples(): readonly StrokeSample[] {
    return this.rawSampleStorage.map(copyStrokeSample);
  }

  /** Returns defensive copies of the derived path samples in emission order. */
  get processedSamples(): readonly StrokeSample[] {
    return this.processedSampleStorage.map(copyStrokeSample);
  }

  /** Returns whether {@link end} has closed this stroke to further input. */
  get isEnded(): boolean {
    return this.hasEnded;
  }

  /** Returns whether at least one generated stamp remains available to consume. */
  get hasPendingStamps(): boolean {
    return this.pendingStampCount > 0;
  }

  /** Returns the number of generated stamps not yet taken by a consumer. */
  get pendingStampCount(): number {
    return this.pendingStamps.length - this.pendingReadIndex;
  }

  /**
   * Creates an empty stroke with fixed path-processing and brush intervals.
   *
   * @param config - Brush, path processing, recorded stroke sequence, or restored seed.
   * @throws {ReverieTypeError} A processing setting is not a number.
   * @throws {ReverieRangeError} Smoothing is outside `(0, 1]` or resample
   * distance is not positive and finite.
   * @throws {ReverieRangeError} Brush size and spacing do not produce a positive,
   * finite stamp distance.
   * @throws {ReverieRangeError} A used seed or sequence is outside uint32.
   */
  constructor(config: StrokeConfig) {
    const smoothing =
      config.smoothing === undefined ? DEFAULT_SMOOTHING : config.smoothing;
    const resampleDistance =
      config.resampleDistance === undefined
        ? DEFAULT_RESAMPLE_DISTANCE
        : config.resampleDistance;
    const stampDistance = config.brush.size * config.brush.spacing;

    Stroke.assertNumber(smoothing, "config.smoothing");
    Stroke.assertNumber(resampleDistance, "config.resampleDistance");

    if (!Number.isFinite(smoothing) || smoothing <= 0 || smoothing > 1) {
      throw ReverieRangeError.from(ErrorDefinitions.STROKE.INVALID_SMOOTHING, {
        received: smoothing,
      });
    }

    if (!Number.isFinite(resampleDistance) || resampleDistance <= 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.INVALID_RESAMPLE_DISTANCE,
        { received: resampleDistance },
      );
    }

    if (!Number.isFinite(stampDistance) || stampDistance <= 0) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.INVALID_STAMP_DISTANCE,
        {
          size: config.brush.size,
          spacing: config.brush.spacing,
        },
      );
    }

    if (config.strokeSeed === undefined) {
      const brushSeed = config.brush.seed === undefined ? 0 : config.brush.seed;
      const strokeSequence =
        config.strokeSequence === undefined ? 0 : config.strokeSequence;
      this.strokeSeed = deriveStrokeSeed(brushSeed, strokeSequence);
    } else {
      // A restored final seed does not consume or validate derivation inputs.
      assertUint32(config.strokeSeed, "strokeSeed");
      this.strokeSeed = config.strokeSeed >>> 0;
    }
    this.brush = config.brush;
    this.smoothing = smoothing;
    this.resampler = new StrokeResampler(resampleDistance);
    this.stampDistance = stampDistance;
  }

  /**
   * Saves one raw input sample, smooths and resamples it, then advances stamp placement.
   *
   * The sample is validated and normalized into a complete canonical sample
   * before entering the pipeline, so omitted pressure and tilt fall back to the
   * Core defaults. Raw samples remain unchanged. The first processed sample
   * immediately queues a command, while later samples preserve independent
   * resampling and stamp distance remainders across segment boundaries. This
   * method never executes the brush.
   *
   * @param sample - Continuous position, timestamp, and optional pressure and
   * tilt attributes.
   * @throws {ReverieError} The stroke has already ended.
   * @throws {ReverieTypeError} A supplied value is not a number.
   * @throws {ReverieRangeError} Position or timestamp is not finite, timestamp
   * order regresses, pressure leaves `[0, 1]`, or tilt leaves `[-90, 90]`.
   * @throws {ReverieRangeError} The uint32 stamp index space is exhausted.
   */
  addSample(sample: StrokeSampleInput): void {
    if (this.hasEnded) {
      throw ReverieError.from(ErrorDefinitions.STROKE.ALREADY_ENDED);
    }

    this.assertValidSample(sample);

    const ownedSample = normalizeStrokeSample(sample);
    const previousRawSample = this.lastRawSample;

    if (previousRawSample !== null) {
      Stroke.assertFiniteSegment(previousRawSample, ownedSample);
    }

    const smoothedSample = smoothStrokeSample(
      this.lastSmoothedSample,
      ownedSample,
      this.smoothing,
    );

    if (this.lastSmoothedSample !== null) {
      Stroke.assertFiniteSegment(this.lastSmoothedSample, smoothedSample);
    }

    this.rawSampleStorage.push(ownedSample);
    this.lastRawSample = ownedSample;
    this.lastSmoothedSample = smoothedSample;
    this.resampler.push(smoothedSample, (processedSample) =>
      this.acceptProcessedSample(processedSample),
    );
  }

  /**
   * Removes and returns the oldest pending stamp command.
   *
   * Taking a command does not execute the brush or report whether a later
   * consumer execution succeeds.
   *
   * @returns The next FIFO command, or `undefined` when no work remains.
   */
  nextStamp(): StampCommand | undefined {
    const command = this.pendingStamps[this.pendingReadIndex];

    if (command === undefined) {
      return undefined;
    }

    this.pendingReadIndex += 1;

    if (this.pendingReadIndex === this.pendingStamps.length) {
      this.pendingStamps = [];
      this.pendingReadIndex = 0;
    } else if (
      this.pendingReadIndex >= PENDING_QUEUE_COMPACTION_THRESHOLD &&
      this.pendingReadIndex * 2 >= this.pendingStamps.length
    ) {
      this.pendingStamps = this.pendingStamps.slice(this.pendingReadIndex);
      this.pendingReadIndex = 0;
    }

    return command;
  }

  /** Marks this stroke as ended; repeated calls have no additional effect. */
  end(): void {
    this.hasEnded = true;
  }

  /** Adds an owned resolved-input snapshot to the tail of the pending FIFO queue. */
  private enqueueStamp(sample: StrokeSample): void {
    // Exhaustion fails instead of wrapping to a duplicate stamp identity.
    if (this.nextStampIndex > 0xffffffff) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.STAMP_INDEX_EXHAUSTED,
      );
    }
    const velocity = deriveStampVelocity(this.lastStampSample, sample);
    const direction = deriveStampDirection(this.lastStampSample, sample);

    this.pendingStamps.push({
      position: { ...sample.position },
      strokeSeed: this.strokeSeed,
      stampIndex: this.nextStampIndex,
      timestamp: sample.timestamp,
      pressure: sample.pressure,
      tiltX: sample.tiltX,
      tiltY: sample.tiltY,
      velocity,
      ...(direction === undefined ? {} : { direction }),
    });
    this.nextStampIndex += 1;
    this.lastStampSample = sample;
  }

  /** Stores one processed sample and advances brush stamp placement. */
  private acceptProcessedSample(sample: StrokeSample): void {
    const previousSample = this.lastProcessedSample;

    this.processedSampleStorage.push(sample);
    this.lastProcessedSample = sample;

    if (previousSample === null) {
      this.enqueueStamp(sample);
      this.distanceSinceLastStamp = 0;
      return;
    }

    this.distanceSinceLastStamp = advanceStampPlacement(
      previousSample,
      sample,
      this.stampDistance,
      this.distanceSinceLastStamp,
      (stampSample) => this.enqueueStamp(stampSample),
    );
  }

  /** Rejects malformed, non-finite, or temporally regressive input samples. */
  private assertValidSample(sample: StrokeSampleInput): void {
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
      this.lastRawSample !== null &&
      sample.timestamp < this.lastRawSample.timestamp
    ) {
      throw ReverieRangeError.from(
        ErrorDefinitions.STROKE.NON_MONOTONIC_TIMESTAMP,
        {
          previous: this.lastRawSample.timestamp,
          received: sample.timestamp,
        },
      );
    }

    Stroke.assertValidPressure(sample.pressure);
    Stroke.assertValidTilt(sample.tiltX, "tiltX");
    Stroke.assertValidTilt(sample.tiltY, "tiltY");
  }

  /** Rejects a present pressure outside the inclusive unit interval. */
  private static assertValidPressure(pressure: number | undefined): void {
    if (pressure === undefined) {
      return;
    }

    Stroke.assertNumber(pressure, "sample.pressure");

    if (!isUnitInterval(pressure)) {
      throw ReverieRangeError.from(ErrorDefinitions.STROKE.INVALID_PRESSURE, {
        received: pressure,
      });
    }
  }

  /** Rejects a present tilt angle outside the accepted degree range. */
  private static assertValidTilt(
    tilt: number | undefined,
    parameterName: string,
  ): void {
    if (tilt === undefined) {
      return;
    }

    Stroke.assertNumber(tilt, `sample.${parameterName}`);

    if (
      !Number.isFinite(tilt) ||
      tilt < MIN_TILT_DEGREES ||
      tilt > MAX_TILT_DEGREES
    ) {
      throw ReverieRangeError.from(ErrorDefinitions.STROKE.INVALID_TILT, {
        param: parameterName,
        received: tilt,
      });
    }
  }

  /** Rejects a segment whose finite endpoints overflow distance arithmetic. */
  private static assertFiniteSegment(
    start: StrokeSample,
    end: StrokeSample,
  ): void {
    const segmentLength = Math.hypot(
      end.position.x - start.position.x,
      end.position.y - start.position.y,
    );

    if (!Number.isFinite(segmentLength)) {
      throw ReverieRangeError.from(ErrorDefinitions.STROKE.NON_FINITE_SEGMENT);
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
