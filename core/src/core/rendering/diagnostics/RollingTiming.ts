import type { TimingMetric } from "../../../interfaces/renderer/TimingMetric.js";

const WINDOW_SIZE = 60;

/** Tracks a fixed number of successful duration samples without unbounded growth. */
export default class RollingTiming {
  private readonly samples: number[] = [];
  private nextIndex = 0;

  /** Adds one measured duration in milliseconds. */
  record(durationMs: number): void {
    if (this.samples.length < WINDOW_SIZE) {
      this.samples.push(durationMs);
      return;
    }
    this.samples[this.nextIndex] = durationMs;
    this.nextIndex = (this.nextIndex + 1) % WINDOW_SIZE;
  }

  /** Drops samples so a newly enabled timing session starts from an empty window. */
  clear(): void {
    this.samples.length = 0;
    this.nextIndex = 0;
  }

  /** Returns an independent view of the latest 60 samples, if any. */
  getSnapshot(): TimingMetric | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }
    const currentIndex =
      (this.nextIndex + this.samples.length - 1) % this.samples.length;
    const current = this.samples[currentIndex] ?? 0;
    const average =
      this.samples.reduce((sum, sample) => sum + sample, 0) /
      this.samples.length;
    return Object.freeze({ current, average, max: Math.max(...this.samples) });
  }
}
