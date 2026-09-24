import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import type { CanvasRendererDiagnosticsSnapshot } from "@reverie/canvas-renderer";

import { DiagnosticsHistoryChart } from "./DiagnosticsHistoryChart";
import type { DiagnosticsPanelProps } from "./interfaces/diagnostics/DiagnosticsPanelProps";
import type { DiagnosticsHistorySample } from "./interfaces/diagnostics/DiagnosticsHistorySample";

/** Shows public renderer diagnostics without owning or altering render work. */
export function DiagnosticsPanel({
  recorder,
}: DiagnosticsPanelProps): ReactElement {
  const [samples, setSamples] = useState<readonly DiagnosticsHistorySample[]>(
    () => recorder.getSamples(),
  );
  const snapshot: CanvasRendererDiagnosticsSnapshot =
    samples.at(-1)?.snapshot ?? recorder.getLatestSnapshot();
  const [framesPerSecond, setFramesPerSecond] = useState<number | null>(null);

  useEffect(() => {
    setSamples(recorder.getSamples());
    const interval = window.setInterval(() => {
      setSamples((previous) => {
        const next = recorder.getSamples();
        return next.at(-1)?.sequence === previous.at(-1)?.sequence
          ? previous
          : next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [recorder]);

  useEffect(() => {
    let frameHandle = 0;
    let intervalStartedAt: number | null = null;
    let frameCount = 0;

    /** Counts browser animation frames over a rolling elapsed-second window. */
    const measureFrameRate = (timestamp: number): void => {
      if (intervalStartedAt === null) {
        intervalStartedAt = timestamp;
      } else {
        frameCount += 1;
        const elapsedMs = timestamp - intervalStartedAt;
        if (elapsedMs >= 1_000) {
          setFramesPerSecond(Math.round((frameCount * 1_000) / elapsedMs));
          intervalStartedAt = timestamp;
          frameCount = 0;
        }
      }
      frameHandle = window.requestAnimationFrame(measureFrameRate);
    };

    frameHandle = window.requestAnimationFrame(measureFrameRate);
    return () => window.cancelAnimationFrame(frameHandle);
  }, []);

  return (
    <div className="diagnostics-layout">
      <DiagnosticsHistoryChart samples={samples} />
      <aside className="diagnostics-panel" aria-label="Renderer diagnostics">
        <p className="layers-eyebrow">Public API example</p>
        <h2>Renderer diagnostics</h2>
        <dl>
          <div>
            <dt>Demo FPS</dt>
            <dd>{framesPerSecond === null ? "—" : framesPerSecond}</dd>
          </div>
        </dl>
        <small className="diagnostics-fps-note">
          FPS 由 demo 独立测量，不属于 getDiagnostics() 提供的参数（实际 API：
          renderer.diagnostics.getSnapshot()）。
        </small>
        <p className="diagnostics-note">Latest render batch / call</p>
        <dl>
          <div>
            <dt>Core</dt>
            <dd>
              {formatDuration(snapshot.rendering?.coreDurationMs.current)}
            </dd>
          </div>
          <div>
            <dt>Raster</dt>
            <dd>
              {formatDuration(snapshot.rendering?.rasterDurationMs.current)}
            </dd>
          </div>
          <div>
            <dt>Composition</dt>
            <dd>
              {formatDuration(
                snapshot.rendering?.compositionDurationMs.current,
              )}
            </dd>
          </div>
          <div>
            <dt>LOD</dt>
            <dd>{formatDuration(snapshot.rendering?.lodDurationMs.current)}</dd>
          </div>
          <div>
            <dt>Presentation</dt>
            <dd>
              {formatDuration(
                snapshot.presentation.presentationDurationMs?.current,
              )}
            </dd>
          </div>
          <div>
            <dt>Canvas upload</dt>
            <dd>
              {formatDuration(snapshot.presentation.uploadDurationMs?.current)}
            </dd>
          </div>
          <div>
            <dt>Canvas draw</dt>
            <dd>
              {formatDuration(snapshot.presentation.drawDurationMs?.current)}
            </dd>
          </div>
          <div>
            <dt>Candidate tiles</dt>
            <dd>{snapshot.tiles.candidateCount}</dd>
          </div>
          <div>
            <dt>Visible tiles</dt>
            <dd>{snapshot.tiles.visibleCount}</dd>
          </div>
          <div>
            <dt>Rendered tiles</dt>
            <dd>{snapshot.tiles.renderedCount}</dd>
          </div>
          <div>
            <dt>Empty tiles</dt>
            <dd>{snapshot.tiles.renderEmptyCount}</dd>
          </div>
          <div>
            <dt>Generated regions</dt>
            <dd>{snapshot.regions.generatedCount}</dd>
          </div>
          <div>
            <dt>Presented regions</dt>
            <dd>{snapshot.regions.presentedCount}</dd>
          </div>
          <div>
            <dt>Pending regions</dt>
            <dd>{snapshot.regions.pendingCount}</dd>
          </div>
          <div>
            <dt>Generated pixels</dt>
            <dd>{snapshot.tiles.generatedPixelBytes.toLocaleString()} B</dd>
          </div>
          <div>
            <dt>Output tile</dt>
            <dd>{snapshot.quality?.outputTileSize ?? "—"} px</dd>
          </div>
        </dl>
        <p className="diagnostics-note">Since renderer creation</p>
        <dl>
          <div>
            <dt>Requests</dt>
            <dd>{snapshot.progressive.requestCount}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{snapshot.progressive.completedRequestCount}</dd>
          </div>
          <div>
            <dt>Cancelled</dt>
            <dd>{snapshot.progressive.cancelledRequestCount}</dd>
          </div>
          <div>
            <dt>Continuations</dt>
            <dd>{snapshot.progressive.continuationCount}</dd>
          </div>
        </dl>
        <code>renderer.diagnostics.getSnapshot()</code>
      </aside>
    </div>
  );
}

/** Formats an optional millisecond sample without suggesting missing data is zero. */
function formatDuration(durationMs: number | undefined): string {
  return durationMs === undefined ? "—" : `${durationMs.toFixed(2)} ms`;
}
