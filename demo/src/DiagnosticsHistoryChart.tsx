import type { ReactElement } from "react";
import { useState } from "react";

import { DIAGNOSTICS_HISTORY_LIMIT } from "./config/DiagnosticsHistoryConfig";
import { exportDiagnosticsHistory } from "./ExportDiagnosticsHistory";
import type { DiagnosticsHistoryChartProps } from "./interfaces/diagnostics/DiagnosticsHistoryChartProps";
import type { DiagnosticsHistorySample } from "./interfaces/diagnostics/DiagnosticsHistorySample";

const CHART_WIDTH = 520;
const CHART_HEIGHT = 220;
const CHART_LEFT = 42;
const CHART_RIGHT = 10;
const CHART_TOP = 10;
const CHART_BOTTOM = 26;

const CHART_SERIES = {
  core: [
    {
      label: "Core",
      color: "#ef9d65",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.coreDurationMs.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.coreDurationMs,
    },
    {
      label: "Raster",
      color: "#87c9bb",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.rasterDurationMs.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.rasterDurationMs,
    },
    {
      label: "Composition",
      color: "#a8a1e6",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.compositionDurationMs.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.compositionDurationMs,
    },
    {
      label: "LOD",
      color: "#e9c57b",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.lodDurationMs.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.rendering?.lodDurationMs,
    },
  ],
  canvas: [
    {
      label: "Presentation",
      color: "#ef9d65",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.presentationDurationMs?.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.presentationDurationMs,
    },
    {
      label: "Upload",
      color: "#87c9bb",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.uploadDurationMs?.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.uploadDurationMs,
    },
    {
      label: "Draw",
      color: "#a8a1e6",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.drawDurationMs?.current,
      metric: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.presentation.drawDurationMs,
    },
  ],
  tiles: [
    {
      label: "Candidate",
      color: "#ef9d65",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.tiles.candidateCount,
    },
    {
      label: "Visible",
      color: "#87c9bb",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.tiles.visibleCount,
    },
    {
      label: "Rendered",
      color: "#a8a1e6",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.tiles.renderedCount,
    },
    {
      label: "Empty",
      color: "#e9c57b",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.tiles.renderEmptyCount,
    },
  ],
  regions: [
    {
      label: "Generated",
      color: "#ef9d65",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.regions.generatedCount,
    },
    {
      label: "Presented",
      color: "#87c9bb",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.regions.presentedCount,
    },
    {
      label: "Pending",
      color: "#a8a1e6",
      value: (sample: DiagnosticsHistorySample) =>
        sample.snapshot.regions.pendingCount,
    },
  ],
} as const;

/** Compares bounded per-render snapshots without retaining chart data in the engine. */
export function DiagnosticsHistoryChart({
  samples,
}: DiagnosticsHistoryChartProps): ReactElement {
  const [mode, setMode] = useState<keyof typeof CHART_SERIES>("core");
  const series = CHART_SERIES[mode];
  const values = samples.flatMap((sample) =>
    series.map((item) => item.value(sample) ?? 0),
  );
  const maximum = Math.max(1, ...values);
  const isTimingMode = mode === "core" || mode === "canvas";
  const latestSample = samples.at(-1);
  const statistics = series.map((item) => {
    const recordedValues = samples.flatMap((sample) => {
      const value = item.value(sample);
      return value === undefined ? [] : [value];
    });
    const metric =
      latestSample !== undefined && "metric" in item
        ? item.metric(latestSample)
        : undefined;
    return {
      label: item.label,
      color: item.color,
      current: metric?.current ?? recordedValues.at(-1),
      average:
        metric?.average ??
        (recordedValues.length === 0
          ? undefined
          : recordedValues.reduce((sum, value) => sum + value, 0) /
            recordedValues.length),
      max:
        metric?.max ??
        (recordedValues.length === 0 ? undefined : Math.max(...recordedValues)),
    };
  });

  return (
    <section className="diagnostics-history" aria-label="Render history chart">
      <div className="diagnostics-history-heading">
        <div>
          <p className="diagnostics-note">Render history</p>
          <strong>
            {samples.length} / {DIAGNOSTICS_HISTORY_LIMIT} samples
          </strong>
        </div>
        <div className="diagnostics-history-actions">
          <span>one sample per render</span>
          <button
            type="button"
            disabled={samples.length === 0}
            onClick={() => exportDiagnosticsHistory(samples)}
          >
            Export JSON
          </button>
        </div>
      </div>
      <div className="diagnostics-chart-tabs" aria-label="Chart metric group">
        <button
          type="button"
          aria-pressed={mode === "core"}
          onClick={() => setMode("core")}
        >
          Core
        </button>
        <button
          type="button"
          aria-pressed={mode === "canvas"}
          onClick={() => setMode("canvas")}
        >
          Canvas
        </button>
        <button
          type="button"
          aria-pressed={mode === "tiles"}
          onClick={() => setMode("tiles")}
        >
          Tiles
        </button>
        <button
          type="button"
          aria-pressed={mode === "regions"}
          onClick={() => setMode("regions")}
        >
          Regions
        </button>
      </div>
      {samples.length === 0 ? (
        <p className="diagnostics-chart-empty">
          Render the canvas to collect history.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={`${mode} metrics across ${samples.length} render calls`}
        >
          <line
            x1={CHART_LEFT}
            x2={CHART_WIDTH - CHART_RIGHT}
            y1={CHART_HEIGHT - CHART_BOTTOM}
            y2={CHART_HEIGHT - CHART_BOTTOM}
            className="diagnostics-chart-axis"
          />
          <line
            x1={CHART_LEFT}
            x2={CHART_WIDTH - CHART_RIGHT}
            y1={CHART_TOP}
            y2={CHART_TOP}
            className="diagnostics-chart-grid"
          />
          <text x={CHART_LEFT - 4} y={CHART_TOP + 3} textAnchor="end">
            {isTimingMode ? maximum.toFixed(1) : Math.ceil(maximum)}
          </text>
          <text
            x={CHART_LEFT - 4}
            y={CHART_HEIGHT - CHART_BOTTOM + 3}
            textAnchor="end"
          >
            0
          </text>
          <text x={CHART_LEFT} y={CHART_HEIGHT - 4}>
            #{samples[0]?.sequence}
          </text>
          <text
            x={CHART_WIDTH - CHART_RIGHT}
            y={CHART_HEIGHT - 4}
            textAnchor="end"
          >
            #{samples.at(-1)?.sequence}
          </text>
          {series.map((item) => (
            <path
              key={item.label}
              d={createSeriesPath(samples, item.value, maximum)}
              stroke={item.color}
            />
          ))}
        </svg>
      )}
      <div className="diagnostics-chart-legend">
        {series.map((item) => (
          <span key={item.label}>
            <i style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div
        className={`diagnostics-chart-stats${isTimingMode ? " is-timing" : ""}`}
        role="table"
        aria-label={`${mode} chart statistics`}
      >
        <div role="row" className="diagnostics-chart-stats-heading">
          <span role="columnheader">Metric</span>
          <span role="columnheader">Latest</span>
          <span role="columnheader">Avg</span>
          <span role="columnheader">Max</span>
          {isTimingMode && <span role="columnheader">Status</span>}
        </div>
        {statistics.map((item) => (
          <div role="row" key={item.label}>
            <span role="cell">
              <i style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span role="cell">
              {formatChartValue(item.current, isTimingMode)}
            </span>
            <span role="cell">
              {formatChartValue(item.average, isTimingMode)}
            </span>
            <span role="cell">{formatChartValue(item.max, isTimingMode)}</span>
            {isTimingMode && (
              <span
                role="cell"
                className="diagnostics-severity"
                data-severity={getDurationSeverity(item.current)}
              >
                {getDurationSeverity(item.current)}
              </span>
            )}
          </div>
        ))}
      </div>
      <small>
        {isTimingMode
          ? "Timings in ms; average and max are the snapshot's rolling values."
          : "Counts per render; average and max use the retained history."}
      </small>
      {isTimingMode && (
        <small className="diagnostics-severity-note">
          Demo heuristic: High at 16.7 ms, Severe at 33.3 ms per stage. This is
          not a diagnostics snapshot field.
        </small>
      )}
    </section>
  );
}

/** Formats an optional series statistic without inventing missing samples. */
function formatChartValue(
  value: number | undefined,
  isTimingMode: boolean,
): string {
  if (value === undefined) {
    return "—";
  }
  return isTimingMode ? value.toFixed(2) : value.toFixed(1);
}

/** Labels one stage's latest duration against the demo's frame-budget guide. */
function getDurationSeverity(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "—";
  }
  if (durationMs >= 33.3) {
    return "Severe";
  }
  if (durationMs >= 16.7) {
    return "High";
  }
  return "Normal";
}

/** Builds one SVG path, leaving gaps where a stage has no measured value. */
function createSeriesPath(
  samples: readonly DiagnosticsHistorySample[],
  getValue: (sample: DiagnosticsHistorySample) => number | undefined,
  maximum: number,
): string {
  let path = "";
  let hasPreviousPoint = false;
  const horizontalSpan = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const verticalSpan = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const value = sample === undefined ? undefined : getValue(sample);
    if (value === undefined) {
      hasPreviousPoint = false;
      continue;
    }
    const x =
      CHART_LEFT + (index / Math.max(1, samples.length - 1)) * horizontalSpan;
    const y = CHART_TOP + (1 - value / maximum) * verticalSpan;
    path += `${hasPreviousPoint ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    hasPreviousPoint = true;
  }
  return path.trim();
}
