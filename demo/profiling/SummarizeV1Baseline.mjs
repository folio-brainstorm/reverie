import { readFile, writeFile } from "node:fs/promises";

const directory = process.argv[2] ?? "v1-step35-run3";
const load = async (name) =>
  JSON.parse(
    await readFile(
      new URL(`./results/${directory}/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const [instrumented, uninstrumented] = await Promise.all([
  load("pan-profile"),
  load("pan-profile-baseline"),
]);

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: values.reduce((total, value) => total + value, 0) / values.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

function phase(frames, name) {
  const selected = frames.filter((frame) => frame.phase === name);
  const count = (read) =>
    selected.reduce((total, frame) => total + read(frame), 0);
  return {
    calls: selected.length,
    timing:
      selected.length === 0
        ? null
        : summarize(selected.map((frame) => frame.metrics.totalMs)),
    visibleMin:
      selected.length === 0
        ? null
        : Math.min(...selected.map((frame) => frame.visible)),
    visibleMax:
      selected.length === 0
        ? null
        : Math.max(...selected.map((frame) => frame.visible)),
    newlyVisible: count((frame) => frame.newlyVisible),
    scanned: count((frame) => frame.metrics.scanned ?? 0),
    resolved: count((frame) => frame.metrics.resolved ?? 0),
    composed: count((frame) => frame.metrics.composed ?? 0),
    lodCalls: count((frame) => frame.metrics.lodCalls ?? 0),
    cacheHits: count((frame) => frame.metrics.cacheHit ?? 0),
    cacheMisses: count((frame) => frame.metrics.cacheMiss ?? 0),
    draws: count((frame) => frame.snapshot.presentation.drawnRegionCount),
    uploads: count((frame) => frame.snapshot.presentation.uploadedRegionCount),
  };
}

const cases = instrumented.cases.map((scenario, index) => {
  const unprobed = uninstrumented.cases[index];
  const delta = (section, key) =>
    scenario.panSnapshot[section][key] - scenario.initialSnapshot[section][key];
  return {
    zoom: scenario.zoom,
    startsInteractive: scenario.startsInteractive,
    cold: {
      instrumentedElapsedMs: scenario.initial.elapsedMs,
      uninstrumentedElapsedMs: unprobed.initial.elapsedMs,
      calls: scenario.initial.calls,
      timing: summarize(scenario.initial.renderDurationsMs),
      generatedRegions: scenario.initial.generatedRegions,
      resolved: scenario.initial.resolved,
      composed: scenario.initial.composed,
      lodCalls: scenario.initial.lodCalls,
      lodMs: scenario.initial.lodMs,
      uploads: scenario.initial.uploads,
      draws: scenario.initial.draws,
      world: scenario.initialSnapshot.world,
      progressive: scenario.initialSnapshot.progressive,
      cache: scenario.initialSnapshot.resultCache,
    },
    pan: phase(scenario.frames, "pan"),
    panUninstrumented: phase(unprobed.frames, "pan").timing,
    hold: phase(scenario.frames, "hold-interactive"),
    settle: phase(scenario.frames, "settle"),
    requests: delta("progressive", "requestCount"),
    completed: delta("progressive", "completedRequestCount"),
    cancelled: delta("progressive", "cancelledRequestCount"),
    viewRequests: delta("scheduling", "requestedCount"),
    viewExecutions: delta("scheduling", "executedCount"),
    finalPendingRequest: scenario.finalSnapshot.progressive.hasPendingRequest,
    cache: scenario.finalSnapshot.resultCache,
    retention: scenario.retention,
    disposed: scenario.disposed,
    maxGenerationPerVariant: scenario.maxGenerationPerVariant,
  };
});

const output = {
  environment: {
    browser: instrumented.browser,
    node: instrumented.node,
    platform: process.platform,
    arch: process.arch,
  },
  fixture: instrumented.fixture,
  method: {
    instrumentedRuns: 1,
    uninstrumentedRuns: 1,
    panTicks: 60,
    outerTiming: "renderer.render call; excludes deferred browser paint",
  },
  cases,
};
const destination = new URL("./V1_RENDER_BASELINE.json", import.meta.url);
await writeFile(destination, JSON.stringify(output, null, 2) + "\n");
console.info(`Saved ${destination.pathname}`);
