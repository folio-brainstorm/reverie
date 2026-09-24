import type { CanvasRenderer } from "@reverie/canvas-renderer";
import type { CanvasRendererDiagnosticsSnapshot } from "@reverie/canvas-renderer";

import { DIAGNOSTICS_HISTORY_LIMIT } from "./config/DiagnosticsHistoryConfig";
import type { DiagnosticsHistorySample } from "./interfaces/diagnostics/DiagnosticsHistorySample";

/** Captures completed render calls for the demo without extending engine APIs. */
export default class DemoDiagnosticsRecorder {
  private readonly renderer: CanvasRenderer;
  private readonly originalRender: CanvasRenderer["render"];
  private readonly samples: DiagnosticsHistorySample[] = [];
  private nextSequence = 1;
  private isInstalled = false;
  private isDisposed = false;

  /** Retains the renderer instance this demo will observe. */
  constructor(renderer: CanvasRenderer) {
    this.renderer = renderer;
    this.originalRender = renderer.render;
  }

  /** Installs a demo-only wrapper on this renderer instance's render method. */
  installOnRenderer(): void {
    if (this.isInstalled || this.isDisposed) {
      return;
    }
    this.renderer.render = (): void => {
      this.originalRender.call(this.renderer);
      this.samples.push(
        Object.freeze({
          sequence: this.nextSequence,
          snapshot: this.renderer.diagnostics.getSnapshot(),
        }),
      );
      this.nextSequence += 1;
      if (this.samples.length > DIAGNOSTICS_HISTORY_LIMIT) {
        this.samples.shift();
      }
    };
    this.isInstalled = true;
  }

  /** Returns an independent ordered list of the latest completed render calls. */
  getSamples(): readonly DiagnosticsHistorySample[] {
    return [...this.samples];
  }

  /** Reads the current public snapshot before the first recorded render. */
  getLatestSnapshot(): CanvasRendererDiagnosticsSnapshot {
    return this.renderer.diagnostics.getSnapshot();
  }

  /** Restores the renderer method before its owner releases the runtime. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    if (this.isInstalled) {
      this.renderer.render = this.originalRender;
      this.isInstalled = false;
    }
    this.isDisposed = true;
  }
}
