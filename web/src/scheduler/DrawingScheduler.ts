import type { DrawingCommand } from "../interfaces/scheduler/DrawingCommand.js";
import type { DrawingSchedulerConfig } from "../interfaces/scheduler/DrawingSchedulerConfig.js";
import type {
  FrameCallback,
  FrameDriver,
} from "../interfaces/scheduler/FrameDriver.js";

import { WebErrorDefinitions } from "../errors/WebErrorDefinitions.js";
import { WebError, WebRangeError, WebTypeError } from "../errors/WebErrors.js";
import { WebFrameDriver } from "./WebFrameDriver.js";

const DEFAULT_FRAME_BUDGET_MS = 4;
const QUEUE_COMPACTION_THRESHOLD = 1024;

/** Cooperatively executes queued drawing commands within a soft frame budget. */
export class DrawingScheduler {
  /** Positive soft work budget for each animation frame, in milliseconds. */
  readonly frameBudget: number;

  /** Runtime-specific frame and timing primitives. */
  private readonly frameDriver: FrameDriver;

  /** Optional presentation callback that can request another progressive frame. */
  private readonly onRender:
    ((hasNewDrawingCommands: boolean) => boolean | void) | undefined;

  /** Optional observer for terminal execution and rendering failures. */
  private readonly onError: ((error: unknown) => void) | undefined;

  /** Commands retained in FIFO order until their execution begins. */
  private commands: DrawingCommand[] = [];

  /** Index of the next unread command, avoiding linear-time array shifts. */
  private readIndex = 0;

  /** Pending one-shot frame handle; `null` remains distinct from handle zero. */
  private frameHandle: number | null = null;

  /** Whether a frame callback is currently executing drawing work. */
  private isRunningFrame = false;

  /** Whether a runtime callback failure permanently stopped scheduling. */
  private hasFailed = false;

  /** Whether lifecycle disposal permanently closed this scheduler. */
  private isDisposed = false;

  /** Whether presentation requested another frame after drawing commands finish. */
  private hasPendingRender = false;

  /**
   * Executes one budgeted frame without depending on a main-thread global.
   * A command is removed immediately before execution, so a throwing command
   * counts as started while later commands remain pending.
   */
  private readonly handleFrame: FrameCallback = () => {
    this.frameHandle = null;

    if (this.isDisposed || this.hasFailed) {
      return;
    }

    this.isRunningFrame = true;
    let processedCommandCount = 0;
    let executingCommand: DrawingCommand | undefined;

    try {
      const startTime = this.frameDriver.now();

      while (this.pendingCommandCount > 0 && !this.isDisposed) {
        const hasExhaustedBudget =
          processedCommandCount > 0 &&
          this.frameDriver.now() - startTime >= this.frameBudget;

        if (hasExhaustedBudget) {
          break;
        }

        const command = this.takeNextCommand();

        if (command === undefined) {
          break;
        }

        executingCommand = command;
        const execute = (): void => this.executeCommand(command);
        if (command.historyTransaction === undefined) {
          execute();
        } else {
          command.historyTransaction.executeMutation(execute);
        }
        processedCommandCount += 1;
        executingCommand = undefined;
      }

      if (
        (processedCommandCount > 0 || this.hasPendingRender) &&
        !this.isDisposed
      ) {
        this.hasPendingRender =
          this.onRender?.(processedCommandCount > 0) === true;
      }
    } catch (error) {
      const transaction = executingCommand?.historyTransaction;
      if (transaction?.cancelled === true && !this.isDisposed) {
        try {
          this.onRender?.(true);
        } catch (renderError) {
          this.fail(
            new AggregateError(
              [error, renderError],
              "Drawing rollback and its recovery render both failed.",
            ),
          );
          return;
        }
      }
      this.fail(error);
      return;
    } finally {
      this.isRunningFrame = false;
    }

    this.scheduleFrame();
  };

  /** Returns work accepted by the scheduler but not yet started. */
  get pendingCommandCount(): number {
    return this.commands.length - this.readIndex;
  }

  /** Returns whether no queued, scheduled, or currently running work exists. */
  get idle(): boolean {
    return (
      this.pendingCommandCount === 0 &&
      this.frameHandle === null &&
      !this.isRunningFrame &&
      !this.hasPendingRender
    );
  }

  /** Returns whether {@link dispose} permanently closed this scheduler. */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Creates a scheduler with injectable runtime primitives and callbacks.
   *
   * @param config - Frame budget, driver, render callback, and error callback.
   * @throws {WebTypeError} The supplied frame budget is not a number.
   * @throws {WebRangeError} The frame budget is not positive and finite.
   * @throws {WebError} The default Web runtime lacks required frame primitives.
   */
  constructor(config: DrawingSchedulerConfig = {}) {
    const frameBudget =
      config.frameBudget === undefined
        ? DEFAULT_FRAME_BUDGET_MS
        : config.frameBudget;

    if (typeof frameBudget !== "number") {
      throw WebTypeError.from(WebErrorDefinitions.INVALID_FRAME_BUDGET_TYPE, {
        received: typeof frameBudget,
      });
    }

    if (!Number.isFinite(frameBudget) || frameBudget <= 0) {
      throw WebRangeError.from(WebErrorDefinitions.INVALID_FRAME_BUDGET);
    }

    this.frameBudget = frameBudget;
    this.frameDriver = config.frameDriver ?? new WebFrameDriver();
    this.onRender = config.onRender;
    this.onError = config.onError;
  }

  /**
   * Appends one command and requests a frame when the scheduler was idle.
   * The command is never executed synchronously by this method.
   *
   * @param command - Executable brush, raster, and stamp context.
   * @throws {WebError} The scheduler was disposed or previously failed.
   * @throws The injected frame driver cannot schedule and no `onError`
   * callback handles the failure.
   */
  enqueue(command: DrawingCommand): void {
    if (this.isDisposed) {
      throw WebError.from(WebErrorDefinitions.SCHEDULER_DISPOSED);
    }

    if (this.hasFailed) {
      throw WebError.from(WebErrorDefinitions.SCHEDULER_FAILED);
    }

    this.commands.push(command);
    this.scheduleFrame();
  }

  /** Requests a render-only frame and continues while rendering remains pending. */
  requestRender(): void {
    if (this.isDisposed || this.hasFailed) {
      return;
    }
    this.hasPendingRender = true;
    this.scheduleFrame();
  }

  /**
   * Cancels pending frame work, clears queued commands, and closes the scheduler.
   * Repeated calls have no additional effect.
   *
   * @throws The injected frame driver rejects cancellation. The scheduler is
   * still disposed and its pending queue is still cleared before the error.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    const frameHandle = this.frameHandle;
    this.frameHandle = null;
    this.commands = [];
    this.readIndex = 0;
    this.hasPendingRender = false;

    if (frameHandle !== null) {
      this.frameDriver.cancelFrame(frameHandle);
    }
  }

  /** Executes one command without interpreting its optional History boundary. */
  private executeCommand(command: DrawingCommand): void {
    if (command.layer === undefined && command.selection == null) {
      command.brush.stamp(
        command.raster,
        command.stamp.position,
        command.stamp,
      );
    } else if (command.layer === undefined) {
      command.brush.stamp(
        command.raster,
        command.stamp.position,
        command.stamp,
        command.selection,
      );
    } else if (command.selection == null) {
      command.layer.stamp(command.brush, command.stamp.position, command.stamp);
    } else {
      command.layer.stamp(
        command.brush,
        command.stamp.position,
        command.stamp,
        command.selection,
      );
    }
  }

  /** Requests one frame only while schedulable work exists. */
  private scheduleFrame(): void {
    if (
      this.frameHandle !== null ||
      this.isRunningFrame ||
      this.isDisposed ||
      this.hasFailed ||
      (this.pendingCommandCount === 0 && !this.hasPendingRender)
    ) {
      return;
    }

    try {
      this.frameHandle = this.frameDriver.requestFrame(this.handleFrame);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Removes the oldest command while occasionally reclaiming consumed storage. */
  private takeNextCommand(): DrawingCommand | undefined {
    const command = this.commands[this.readIndex];

    if (command === undefined) {
      return undefined;
    }

    this.readIndex += 1;

    if (this.readIndex === this.commands.length) {
      this.commands = [];
      this.readIndex = 0;
    } else if (
      this.readIndex >= QUEUE_COMPACTION_THRESHOLD &&
      this.readIndex * 2 >= this.commands.length
    ) {
      this.commands = this.commands.slice(this.readIndex);
      this.readIndex = 0;
    }

    return command;
  }

  /** Enters a terminal failure state and reports or rethrows the cause. */
  private fail(error: unknown): void {
    this.hasFailed = true;
    this.frameHandle = null;

    if (this.onError === undefined) {
      throw error;
    }

    this.onError(error);
  }
}
