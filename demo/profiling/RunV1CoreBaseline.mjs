import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { PixelBrush, Raster, Stroke, World } from "@reveriejs/core";
import { RenderingCore } from "@reveriejs/core/rendering";
import { getRasterTileVersion } from "@reveriejs/core/rendering/internal";

const TILE_SIZE = 256;
const COLOR = { r: 120, g: 80, b: 40, a: 255 };
const TRIALS = 7;
const WARMUPS = 2;

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

function runTrials(run) {
  for (let index = 0; index < WARMUPS; index += 1) run();
  const results = Array.from({ length: TRIALS }, run);
  return {
    ...results[0],
    timing: summarize(results.map((result) => result.elapsedMs)),
  };
}

function time(operation) {
  const startedAt = performance.now();
  const result = operation();
  return { result, elapsedMs: performance.now() - startedAt };
}

const raster = [
  {
    name: "tile-allocation",
    run() {
      const target = new Raster({ tileSize: TILE_SIZE });
      const measured = time(() => {
        for (let y = 0; y < 4; y += 1)
          for (let x = 0; x < 4; x += 1)
            target.setPixel({ x: x * TILE_SIZE, y: y * TILE_SIZE }, COLOR);
      });
      return {
        elapsedMs: measured.elapsedMs,
        writes: 16,
        ...target.getStatistics(),
      };
    },
  },
  {
    name: "repeated-writes",
    run() {
      const target = new Raster({ tileSize: TILE_SIZE });
      target.setPixel({ x: 0, y: 0 }, COLOR);
      const revisionBefore = getRasterTileVersion(target, {
        x: 0,
        y: 0,
      })?.revision;
      const measured = time(() => {
        for (let index = 0; index < 4096; index += 1)
          target.setPixel({ x: index % 64, y: Math.floor(index / 64) }, COLOR);
      });
      return {
        elapsedMs: measured.elapsedMs,
        writes: 4096,
        revisionBefore,
        revisionAfter: getRasterTileVersion(target, { x: 0, y: 0 })?.revision,
        ...target.getStatistics(),
      };
    },
  },
  {
    name: "cross-tile-stamps",
    run() {
      const target = new Raster({ tileSize: TILE_SIZE });
      const brush = new PixelBrush({ size: 3, color: COLOR });
      const measured = time(() => {
        for (let index = 0; index < 512; index += 1)
          brush.stamp(target, { x: TILE_SIZE - 0.5, y: index + 0.5 });
      });
      return {
        elapsedMs: measured.elapsedMs,
        stamps: 512,
        ...target.getStatistics(),
      };
    },
  },
];

const brush = new PixelBrush({ size: 1, color: COLOR });
const strokeCases = [
  {
    name: "short",
    points: [
      [0.5, 0.5],
      [1.4, 0.5],
    ],
  },
  {
    name: "medium-cross-tile",
    points: Array.from({ length: 33 }, (_, i) => [i * 24 + 0.5, 255.5]),
  },
  {
    name: "long-sparse",
    points: Array.from({ length: 9 }, (_, i) => [i * 512 + 0.5, 255.5]),
  },
];

function runStroke(points) {
  const target = new Raster({ tileSize: TILE_SIZE });
  const stroke = new Stroke({ brush });
  const processing = time(() => {
    points.forEach(([x, y], index) =>
      stroke.addSample({ position: { x, y }, timestamp: index }),
    );
    stroke.end();
  });
  let stampCount = 0;
  const writing = time(() => {
    for (
      let command = stroke.nextStamp();
      command !== undefined;
      command = stroke.nextStamp()
    ) {
      brush.stamp(target, command.position, command);
      stampCount++;
    }
  });
  return {
    elapsedMs: processing.elapsedMs + writing.elapsedMs,
    processingMs: processing.elapsedMs,
    rasterWriteMs: writing.elapsedMs,
    inputSamples: points.length,
    processedSamples: stroke.processedSamples.length,
    stampCount,
    ...target.getStatistics(),
  };
}

function createCompositionWorld(layerCount) {
  const world = new World({
    tileSize: TILE_SIZE,
    bounds: { x: 0, y: 0, width: 512, height: 512 },
  });
  while (world.layers.length < layerCount) world.addLayer();
  for (const [layerIndex, layer] of world.layers.entries())
    for (let y = 0; y < 512; y += 1)
      for (let x = 0; x < 512; x += 1)
        layer.raster.setPixel(
          { x, y },
          {
            r: 120,
            g: 80 + layerIndex * 20,
            b: 40,
            a: layerIndex === 0 ? 255 : 100,
          },
        );
  return world;
}

function renderWorld(world, scale, quality = "full") {
  const core = new RenderingCore({ diagnostics: { timings: true } });
  const startedAt = performance.now();
  let result = core.render({
    source: { world },
    context: { scale, quality },
    viewport: { x: 0, y: 0, width: 512, height: 512 },
  });
  let regionCount = result.regions.length;
  while (result.continuation !== undefined) {
    result = core.continueRender(result.continuation);
    regionCount += result.regions.length;
  }
  const elapsedMs = performance.now() - startedAt;
  const snapshot = core.getDiagnosticsSnapshot();
  const output = {
    elapsedMs,
    regionCount,
    outputTileSize: snapshot.quality?.outputTileSize,
    cache: snapshot.resultCache,
    world: snapshot.world,
    progressive: snapshot.progressive,
    timings: snapshot.rendering,
  };
  core.dispose();
  return output;
}

const composition = [];
for (const layerCount of [1, 2, 4]) {
  const world = createCompositionWorld(layerCount);
  for (const scale of [1, 0.25]) {
    const baseline = runTrials(() => renderWorld(world, scale));
    composition.push({
      layerCount,
      scale,
      inputTiles: layerCount * 4,
      outputPixels: 4 * baseline.outputTileSize ** 2,
      ...baseline,
    });
  }
}

const output = {
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  method: {
    warmups: WARMUPS,
    trials: TRIALS,
    timing: "performance.now(), instrumented Core diagnostics enabled",
  },
  fixture: {
    tileSize: TILE_SIZE,
    strokeBrush: "opaque PixelBrush size=1 spacing=0.25",
    compositionWorld: "512x512 dense, 4 tiles/layer",
  },
  raster: raster.map(({ name, run }) => ({ name, ...runTrials(run) })),
  strokes: strokeCases.map(({ name, points }) => {
    for (let index = 0; index < WARMUPS; index += 1) runStroke(points);
    const samples = Array.from({ length: TRIALS }, () => runStroke(points));
    return {
      name,
      ...samples[0],
      timing: summarize(samples.map((sample) => sample.elapsedMs)),
      processingTiming: summarize(samples.map((sample) => sample.processingMs)),
      rasterWriteTiming: summarize(
        samples.map((sample) => sample.rasterWriteMs),
      ),
    };
  }),
  composition,
};
const destination = new URL("./V1_CORE_BASELINE.json", import.meta.url);
await writeFile(destination, JSON.stringify(output, null, 2) + "\n");
console.info(`Saved ${destination.pathname}`);
