import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrushImage,
  CircleBrush,
  ImageBrush,
  Raster,
  Stroke,
} from "@reverie/core";
import type { Brush, StampCommand } from "@reverie/core";
import { ExportRenderer } from "@reverie/exporter";

import {
  DrawingScheduler,
  WebError,
  WebErrorDefinitions,
  WebFrameDriver,
  WebRangeError,
  WebTypeError,
} from "../index.js";
import type {
  DrawingCommand,
  DrawingSchedulerConfig,
  FrameCallback,
  FrameDriver,
} from "../index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DrawingScheduler construction", () => {
  it("is available with its contracts through the public package entry point", () => {
    const frameDriver: FrameDriver = new ManualFrameDriver();
    const config: DrawingSchedulerConfig = { frameDriver };
    const scheduler = new DrawingScheduler(config);

    expect(scheduler.frameBudget).toBe(4);
    expect(scheduler.pendingCommandCount).toBe(0);
    expect(scheduler.idle).toBe(true);
    expect(scheduler.disposed).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid frame budget %s",
    (frameBudget) => {
      const createScheduler = () =>
        new DrawingScheduler({
          frameBudget,
          frameDriver: new ManualFrameDriver(),
        });

      expect(createScheduler).toThrow(WebRangeError);
      expect(createScheduler).toThrow(
        `[${WebErrorDefinitions.INVALID_FRAME_BUDGET.code}]`,
      );
    },
  );

  it("rejects a non-number frame budget at runtime", () => {
    const createScheduler = () =>
      new DrawingScheduler({
        // @ts-expect-error Runtime validation protects JavaScript callers.
        frameBudget: "4",
        frameDriver: new ManualFrameDriver(),
      });

    expect(createScheduler).toThrow(WebTypeError);
    expect(createScheduler).toThrow(
      `[${WebErrorDefinitions.INVALID_FRAME_BUDGET_TYPE.code}]`,
    );
  });
});

describe("DrawingScheduler frame execution", () => {
  it("defers execution and schedules only one frame for consecutive enqueues", () => {
    const driver = new ManualFrameDriver();
    const executed: number[] = [];
    const scheduler = new DrawingScheduler({ frameDriver: driver });

    scheduler.enqueue(createCommand(1, () => executed.push(1)));
    scheduler.enqueue(createCommand(2, () => executed.push(2)));
    scheduler.enqueue(createCommand(3, () => executed.push(3)));

    expect(executed).toEqual([]);
    expect(driver.requestCount).toBe(1);
    expect(driver.pendingFrameCount).toBe(1);
    expect(scheduler.pendingCommandCount).toBe(3);
    expect(scheduler.idle).toBe(false);
  });

  it("executes commands in FIFO order and coalesces rendering", () => {
    const driver = new ManualFrameDriver();
    const executed: number[] = [];
    const onRender = vi.fn();
    const scheduler = new DrawingScheduler({
      frameDriver: driver,
      onRender,
    });

    for (let identifier = 1; identifier <= 4; identifier += 1) {
      scheduler.enqueue(
        createCommand(identifier, () => executed.push(identifier)),
      );
    }

    driver.runNextFrame();

    expect(executed).toEqual([1, 2, 3, 4]);
    expect(onRender).toHaveBeenCalledOnce();
    expect(scheduler.pendingCommandCount).toBe(0);
    expect(scheduler.idle).toBe(true);
    expect(driver.pendingFrameCount).toBe(0);
  });

  it("forwards the complete stamp context without interpreting dynamics", () => {
    const driver = new ManualFrameDriver();
    const raster = new Raster();
    const stamp = {
      position: { x: 2, y: 3 },
      timestamp: 10,
      pressure: 0.25,
      tiltX: -20,
      tiltY: 30,
      velocity: 0.5,
      direction: Math.PI / 4,
      strokeSeed: 0xffffffff,
      stampIndex: 7,
    };
    const stampBrush = vi.fn<Brush["stamp"]>();
    const brush: Brush = { size: 1, spacing: 1, stamp: stampBrush };
    const scheduler = new DrawingScheduler({ frameDriver: driver });

    scheduler.enqueue({ stamp, brush, raster });
    driver.runNextFrame();

    expect(stampBrush).toHaveBeenCalledOnce();
    expect(stampBrush).toHaveBeenCalledWith(raster, stamp.position, stamp);
  });

  it("splits work across frames when the soft budget is exhausted", () => {
    const driver = new ManualFrameDriver();
    const executed: number[] = [];
    const onRender = vi.fn();
    const scheduler = new DrawingScheduler({
      frameBudget: 5,
      frameDriver: driver,
      onRender,
    });

    for (let identifier = 1; identifier <= 5; identifier += 1) {
      scheduler.enqueue(
        createCommand(identifier, () => {
          executed.push(identifier);
          driver.advanceTime(2);
        }),
      );
    }

    driver.runNextFrame();

    expect(executed).toEqual([1, 2, 3]);
    expect(scheduler.pendingCommandCount).toBe(2);
    expect(driver.pendingFrameCount).toBe(1);
    expect(onRender).toHaveBeenCalledOnce();

    driver.runNextFrame();

    expect(executed).toEqual([1, 2, 3, 4, 5]);
    expect(scheduler.idle).toBe(true);
    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it("executes at least one command when a single command exceeds the budget", () => {
    const driver = new ManualFrameDriver();
    const executed: number[] = [];
    const scheduler = new DrawingScheduler({
      frameBudget: 0.01,
      frameDriver: driver,
    });

    scheduler.enqueue(
      createCommand(1, () => {
        executed.push(1);
        driver.advanceTime(100);
      }),
    );
    scheduler.enqueue(createCommand(2, () => executed.push(2)));

    driver.runNextFrame();

    expect(executed).toEqual([1]);
    expect(scheduler.pendingCommandCount).toBe(1);
    expect(driver.pendingFrameCount).toBe(1);
  });

  it("requests a fresh frame when new work wakes an idle scheduler", () => {
    const driver = new ManualFrameDriver();
    const scheduler = new DrawingScheduler({ frameDriver: driver });

    scheduler.enqueue(createCommand(1, () => undefined));
    driver.runNextFrame();
    expect(scheduler.idle).toBe(true);

    scheduler.enqueue(createCommand(2, () => undefined));

    expect(driver.requestCount).toBe(2);
    expect(driver.pendingFrameCount).toBe(1);
  });
});

describe("DrawingScheduler lifecycle and failures", () => {
  it("cancels a pending handle including zero and clears work on dispose", () => {
    const driver = new ManualFrameDriver();
    const scheduler = new DrawingScheduler({ frameDriver: driver });

    scheduler.enqueue(createCommand(1, () => undefined));
    scheduler.dispose();
    scheduler.dispose();

    expect(driver.cancelledHandles).toEqual([0]);
    expect(driver.pendingFrameCount).toBe(0);
    expect(scheduler.pendingCommandCount).toBe(0);
    expect(scheduler.disposed).toBe(true);
    expect(scheduler.idle).toBe(true);
    expect(() => scheduler.enqueue(createCommand(2, () => undefined))).toThrow(
      WebError,
    );
    expect(() => scheduler.enqueue(createCommand(2, () => undefined))).toThrow(
      `[${WebErrorDefinitions.SCHEDULER_DISPOSED.code}]`,
    );
  });

  it("does not render when disposal occurs during command execution", () => {
    const driver = new ManualFrameDriver();
    const onRender = vi.fn();
    let scheduler: DrawingScheduler;
    scheduler = new DrawingScheduler({ frameDriver: driver, onRender });
    scheduler.enqueue(createCommand(1, () => scheduler.dispose()));
    scheduler.enqueue(createCommand(2, () => undefined));

    driver.runNextFrame();

    expect(scheduler.disposed).toBe(true);
    expect(scheduler.pendingCommandCount).toBe(0);
    expect(onRender).not.toHaveBeenCalled();
    expect(driver.pendingFrameCount).toBe(0);
  });

  it("stops after a stamp failure and retains commands not yet started", () => {
    const driver = new ManualFrameDriver();
    const stampError = new Error("stamp failed");
    const onError = vi.fn();
    const onRender = vi.fn();
    const scheduler = new DrawingScheduler({
      frameDriver: driver,
      onError,
      onRender,
    });

    scheduler.enqueue(
      createCommand(1, () => {
        throw stampError;
      }),
    );
    scheduler.enqueue(createCommand(2, () => undefined));
    driver.runNextFrame();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(stampError);
    expect(onRender).not.toHaveBeenCalled();
    expect(scheduler.pendingCommandCount).toBe(1);
    expect(driver.pendingFrameCount).toBe(0);
    expect(() => scheduler.enqueue(createCommand(3, () => undefined))).toThrow(
      `[${WebErrorDefinitions.SCHEDULER_FAILED.code}]`,
    );
  });

  it("enters the same terminal state when onRender throws", () => {
    const driver = new ManualFrameDriver();
    const renderError = new Error("render failed");
    const onError = vi.fn();
    const scheduler = new DrawingScheduler({
      frameDriver: driver,
      onError,
      onRender: () => {
        throw renderError;
      },
    });

    scheduler.enqueue(createCommand(1, () => undefined));
    driver.runNextFrame();

    expect(onError).toHaveBeenCalledWith(renderError);
    expect(scheduler.pendingCommandCount).toBe(0);
    expect(() => scheduler.enqueue(createCommand(2, () => undefined))).toThrow(
      `[${WebErrorDefinitions.SCHEDULER_FAILED.code}]`,
    );
  });

  it("rethrows an execution failure when no error callback is configured", () => {
    const driver = new ManualFrameDriver();
    const stampError = new Error("unhandled stamp failure");
    const scheduler = new DrawingScheduler({ frameDriver: driver });

    scheduler.enqueue(
      createCommand(1, () => {
        throw stampError;
      }),
    );

    expect(() => driver.runNextFrame()).toThrow(stampError);
    expect(() => scheduler.enqueue(createCommand(2, () => undefined))).toThrow(
      `[${WebErrorDefinitions.SCHEDULER_FAILED.code}]`,
    );
  });

  it("enters the failed state when the FrameDriver cannot schedule", () => {
    const schedulingError = new Error("scheduling failed");
    const onError = vi.fn();
    const frameDriver: FrameDriver = {
      requestFrame(): number {
        throw schedulingError;
      },
      cancelFrame(): void {},
      now(): number {
        return 0;
      },
    };
    const scheduler = new DrawingScheduler({ frameDriver, onError });

    scheduler.enqueue(createCommand(1, () => undefined));

    expect(onError).toHaveBeenCalledWith(schedulingError);
    expect(scheduler.pendingCommandCount).toBe(1);
    expect(() => scheduler.enqueue(createCommand(2, () => undefined))).toThrow(
      `[${WebErrorDefinitions.SCHEDULER_FAILED.code}]`,
    );
  });
});

describe("DrawingScheduler deterministic jitter and scatter", () => {
  it.each(["CircleBrush", "ImageBrush"])(
    "keeps %s pixels identical across frame budgets, clocks, and render delays",
    (brushName) => {
      const config = {
        size: 6,
        color: { r: 84, g: 153, b: 255, a: 255 },
        opacity: 0.6,
        seed: 0xffffffff,
        jitter: { size: 0.3, opacity: 0.3, rotation: 0.5 },
        scatter: { along: 0.25, across: 0.15 },
      };
      const brush =
        brushName === "CircleBrush"
          ? new CircleBrush(config)
          : new ImageBrush({
              ...config,
              image: new BrushImage({
                width: 2,
                height: 1,
                alpha: new Uint8Array([255, 96]),
              }),
              dynamics: { rotation: { direction: {} } },
            });
      const stroke = new Stroke({ brush, strokeSequence: 17 });
      stroke.addSample({ position: { x: 0.5, y: 0.5 }, timestamp: 0 });
      stroke.addSample({ position: { x: 20.5, y: 0.5 }, timestamp: 20 });
      stroke.addSample({ position: { x: 20.5, y: 12.5 }, timestamp: 32 });
      stroke.end();
      const commands: StampCommand[] = [];
      for (
        let stamp = stroke.nextStamp();
        stamp !== undefined;
        stamp = stroke.nextStamp()
      ) {
        commands.push(stamp);
      }

      const paint = (
        frameBudget: number,
        frameDelay: number,
      ): Uint8ClampedArray => {
        const driver = new ManualFrameDriver();
        const raster = new Raster({ tileSize: 16 });
        const timedBrush: Brush = {
          size: brush.size,
          spacing: brush.spacing,
          seed: brush.seed,
          stamp(target, position, input): void {
            brush.stamp(target, position, input);
            driver.advanceTime(2);
          },
        };
        const scheduler = new DrawingScheduler({
          frameBudget,
          frameDriver: driver,
          onRender: () => driver.advanceTime(frameDelay),
        });
        for (const stamp of commands) {
          scheduler.enqueue({ brush: timedBrush, raster, stamp });
        }
        while (!scheduler.idle) {
          driver.advanceTime(frameDelay);
          driver.runNextFrame();
        }
        expect(driver.requestCount).toBe(
          frameBudget === 1 ? commands.length : 1,
        );
        scheduler.dispose();
        return new ExportRenderer({ raster }).render({
          x: -8,
          y: -8,
          width: 40,
          height: 32,
        }).pixels;
      };

      const buffered = paint(100, 0);
      expect(buffered.some((byte) => byte > 0)).toBe(true);
      expect(paint(1, 1000)).toEqual(buffered);
    },
  );
});

describe("WebFrameDriver", () => {
  it("delegates frame and time operations to the current global scope", () => {
    const callbacks: FrameCallback[] = [];
    const requestFrame = vi.fn((callback: FrameCallback): number => {
      callbacks.push(callback);
      return 7;
    });
    const cancelFrame = vi.fn();
    const now = vi.fn(() => 12.5);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    vi.stubGlobal("performance", { now });
    const driver = new WebFrameDriver();
    const callback = vi.fn();

    expect(driver.requestFrame(callback)).toBe(7);
    callbacks[0]?.(99);
    driver.cancelFrame(7);

    expect(callback).toHaveBeenCalledWith(99);
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(driver.now()).toBe(12.5);
  });

  it.each([
    ["requestAnimationFrame", undefined],
    ["cancelAnimationFrame", undefined],
    ["performance", undefined],
  ])("rejects a runtime without %s", (capability, value) => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("performance", { now: vi.fn(() => 0) });
    vi.stubGlobal(capability, value);

    const createDriver = () => new WebFrameDriver();

    expect(createDriver).toThrow(WebError);
    expect(createDriver).toThrow(
      `[${WebErrorDefinitions.FRAME_SCHEDULING_UNAVAILABLE.code}]`,
    );
  });
});

/** Creates one executable command with deterministic test behavior. */
function createCommand(positionX: number, onStamp: () => void): DrawingCommand {
  const brush: Brush = {
    size: 1,
    spacing: 1,
    stamp(): void {
      onStamp();
    },
  };

  return {
    stamp: { position: { x: positionX, y: 0 } },
    brush,
    raster: new Raster(),
  };
}

/** Deterministic one-shot frame driver for scheduler unit tests. */
class ManualFrameDriver implements FrameDriver {
  private readonly callbacks = new Map<number, FrameCallback>();
  private currentTime = 0;
  private nextHandle = 0;
  private requestCallCount = 0;
  private readonly cancelled: number[] = [];

  /** Returns how many frames were requested during the test. */
  get requestCount(): number {
    return this.requestCallCount;
  }

  /** Returns how many requested frames have not run or been cancelled. */
  get pendingFrameCount(): number {
    return this.callbacks.size;
  }

  /** Returns cancelled handles in cancellation order. */
  get cancelledHandles(): readonly number[] {
    return [...this.cancelled];
  }

  /** Stores a one-shot callback until the test advances a frame. */
  requestFrame(callback: FrameCallback): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.requestCallCount += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  /** Removes a pending callback and records its handle. */
  cancelFrame(handle: number): void {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  /** Returns deterministic simulated time in milliseconds. */
  now(): number {
    return this.currentTime;
  }

  /** Advances the simulated high-resolution clock. */
  advanceTime(milliseconds: number): void {
    this.currentTime += milliseconds;
  }

  /** Runs the oldest pending frame callback exactly once. */
  runNextFrame(): void {
    const nextEntry = this.callbacks.entries().next();

    if (nextEntry.done) {
      throw new Error("No frame is pending.");
    }

    const [handle, callback] = nextEntry.value;
    this.callbacks.delete(handle);
    callback(this.currentTime);
  }
}
