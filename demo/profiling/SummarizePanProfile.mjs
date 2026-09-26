import { readFile, writeFile } from "node:fs/promises";

const filename = process.argv[2] ?? "pan-profile";
const source = JSON.parse(
  await readFile(
    new URL(`./results/${filename}.json`, import.meta.url),
    "utf8",
  ),
);

/** Summarizes actual renderer calls; nested times are kept separate from totals. */
function summarize(frames) {
  const sum = (read) => frames.reduce((total, frame) => total + read(frame), 0);
  const times = frames
    .map((frame) => frame.metrics.totalMs)
    .sort((a, b) => a - b);
  const result = { calls: frames.length };
  for (const key of [
    "totalMs",
    "coreMs",
    "scanned",
    "scanMs",
    "resolved",
    "composed",
    "compositionInclusiveMs",
    "cacheHit",
    "cacheMiss",
    "cacheMs",
    "lodCalls",
    "lodMs",
    "copyMs",
    "lodSourcePixels",
    "tilesDrawnRepeatedly",
  ]) {
    result[key] =
      !source.instrument && key !== "totalMs"
        ? null
        : sum((frame) => frame.metrics[key] ?? 0);
  }
  result.presentationMs = sum(
    (frame) => frame.snapshot.presentation.presentationDurationMs?.current ?? 0,
  );
  result.drawMs = sum(
    (frame) => frame.snapshot.presentation.drawDurationMs?.current ?? 0,
  );
  result.uploadMs = sum(
    (frame) => frame.snapshot.presentation.uploadDurationMs?.current ?? 0,
  );
  result.draws = sum((frame) => frame.snapshot.presentation.drawnRegionCount);
  result.uploads = sum(
    (frame) => frame.snapshot.presentation.uploadedRegionCount,
  );
  result.newlyVisible = sum((frame) => frame.newlyVisible);
  result.visibleMin = Math.min(...frames.map((frame) => frame.visible));
  result.visibleMax = Math.max(...frames.map((frame) => frame.visible));
  result.averageMs = result.totalMs / frames.length;
  result.p95Ms = times[Math.ceil(times.length * 0.95) - 1];
  result.maxMs = times.at(-1);
  result.coreCacheHitRate =
    result.cacheHit + result.cacheMiss === 0
      ? null
      : result.cacheHit / (result.cacheHit + result.cacheMiss);
  result.maxDrawsPerTile = source.instrument
    ? Math.max(0, ...frames.map((frame) => frame.metrics.maxDrawsPerTile ?? 0))
    : null;
  result.batchCoreMs = sum(
    (frame) => frame.snapshot.rendering?.coreDurationMs.current ?? 0,
  );
  return result;
}

const summary = source.cases.map((scenario) => {
  const pan = scenario.frames.filter((frame) => frame.phase === "pan");
  const delta = (section, key) =>
    scenario.panSnapshot[section][key] - scenario.initialSnapshot[section][key];
  return {
    zoom: scenario.zoom,
    startsInteractive: scenario.startsInteractive,
    panElapsedMs: scenario.panElapsedMs,
    viewRequests: delta("scheduling", "requestedCount"),
    viewExecutions: delta("scheduling", "executedCount"),
    reportedCoalesced: delta("scheduling", "coalescedCount"),
    requests: delta("progressive", "requestCount"),
    cancelled: delta("progressive", "cancelledRequestCount"),
    completed: delta("progressive", "completedRequestCount"),
    validationFailures: delta("resultCache", "validationFailures"),
    evictions: delta("resultCache", "evictions"),
    outputSizes: [
      ...new Set(pan.map((frame) => frame.snapshot.quality?.outputTileSize)),
    ],
    maxPanGenerationPerVariant: source.instrument
      ? Math.max(
          0,
          ...Object.entries(scenario.generationByTile)
            .filter(([key]) => JSON.parse(key)[0] === "pan")
            .map(([, count]) => count),
        )
      : null,
    firstCompletedPanFrame: pan.findIndex((frame) => !frame.snapshot.progressive.hasPendingRequest) + 1 || null,
    retention: scenario.retention ?? null,
    pan: summarize(pan),
    steady: summarize(pan.slice(30)),
    tail15: summarize(pan.slice(-15)),
    hold: summarize(
      scenario.frames.filter((frame) => frame.phase === "hold-interactive"),
    ),
    settle: summarize(
      scenario.frames.filter((frame) => frame.phase === "settle"),
    ),
    frame42: pan[41],
  };
});
await writeFile(
  new URL(`./results/${filename}-summary.json`, import.meta.url),
  JSON.stringify(summary, null, 2),
);
console.table(
  summary.map((s) => ({
    zoom: s.zoom,
    interactiveStart: s.startsInteractive,
    visible: s.pan.visibleMax,
    output: s.outputSizes.join(","),
    requests: s.requests,
    completed: s.completed,
    cancelled: s.cancelled,
    composed: s.pan.composed,
    resolved: s.pan.resolved,
    draws: s.pan.draws,
    meanMs: s.pan.averageMs.toFixed(2),
    steadyMs: s.steady.averageMs.toFixed(2),
    p95Ms: s.pan.p95Ms?.toFixed(2),
    elapsedMs: s.panElapsedMs.toFixed(0),
  })),
);
