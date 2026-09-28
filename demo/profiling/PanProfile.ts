import { Camera, CircleBrush, World } from "@reverie/core";
import { getRasterTileVersion } from "@reverie/core/rendering/internal";
import { CanvasRenderer } from "@reverie/canvas-renderer";
import { CanvasDrawingSession } from "@reverie/web";

import type { PanProfileFrame } from "./interfaces/PanProfileFrame";
import tapPanMethod from "./TapPanMethod";

const TILE_SIZE = 256;
const WORLD_SIZE = 4096;
const WIDTH = 768;
const HEIGHT = 512;

/**
 * Replays fixed CSS-pixel Pan input through the real Web session and Canvas backend.
 * Fixture creation and initial canonical rendering are excluded from Pan timings.
 * @param instrument - Collect internal per-Tile spans; false keeps public counters and outer render timing only.
 * @param scenarioIndex - One scenario from 0 to 5, or -1 for the complete comparison.
 * @returns Raw per-call observations and fixture metadata for offline analysis.
 */
export default async function runPanProfile(
  instrument = true,
  scenarioIndex = -1,
): Promise<Record<string, unknown>> {
  const world = new World({
    tileSize: TILE_SIZE,
    bounds: { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE },
  });
  world.addLayer();
  console.info("Pan profile: creating immutable two-layer 4096 x 4096 fixture");
  for (const [layerIndex, layer] of world.layers.entries()) {
    for (let y = 0; y < WORLD_SIZE; y += 1) {
      for (let x = 0; x < WORLD_SIZE; x += 1) {
        layer.raster.setPixel(
          { x, y },
          {
            r: (x >> 4) & 255,
            g: (y >> 4) & 255,
            b: 80 + layerIndex * 80,
            a: layerIndex === 0 ? 255 : 100,
          },
        );
      }
    }
  }
  const versions = (): string =>
    JSON.stringify(
      world.layers.flatMap((layer) => {
        const values = [];
        for (let y = 0; y < 16; y += 1)
          for (let x = 0; x < 16; x += 1)
            values.push(getRasterTileVersion(layer.raster, { x, y }));
        return values;
      }),
    );
  const initialVersions = versions();
  const cases: Record<string, unknown>[] = [];
  const scenarios = [
    ...[1, 0.5, 0.25, 0.0625].map((zoom) => ({
      zoom,
      startsInteractive: false,
    })),
    { zoom: 0.25, startsInteractive: true },
    { zoom: 0.0625, startsInteractive: true },
  ];
  for (const { zoom, startsInteractive } of scenarios.filter(
    (_value, index) => scenarioIndex < 0 || scenarioIndex === index,
  )) {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    document.body.replaceChildren(canvas);
    const camera = new Camera({
      zoom,
      panX: WORLD_SIZE / 2 - WIDTH / zoom / 2,
      panY: WORLD_SIZE / 2 - HEIGHT / zoom / 2,
    });
    const renderer = new CanvasRenderer({
      canvas,
      camera,
      world,
      diagnostics: { timings: true },
    });
    const session = new CanvasDrawingSession({
      canvas,
      camera,
      world,
      layer: world.getLayer(0),
      raster: world.getLayer(0).raster,
      renderer,
      brush: new CircleBrush({ size: 1, color: { r: 0, g: 0, b: 0, a: 255 } }),
    });
    const core = requireObject(renderer, "renderingCore");
    const cache = requireObject(core, "resultCache");
    const backend = requireObject(renderer, "backend");
    const frames: PanProfileFrame[] = [];
    const generationByTile = new Map<string, number>();
    let metrics: Record<string, number> = {};
    let drawnTiles = new Map<string, number>();
    let phase = "initial";
    let previousVisible = visibleKeys(camera);
    const add = (key: string, amount = 1): void => {
      metrics[key] = (metrics[key] ?? 0) + amount;
    };
    if (instrument)
      Reflect.set(
        globalThis,
        "__reveriePanLod",
        (duration: number, source: number, output: number): void => {
          add(source === output ? "copyCalls" : "lodCalls");
          add(source === output ? "copyMs" : "lodMs", duration);
          if (source !== output) add("lodSourcePixels", source ** 2);
        },
      );
    const restore = instrument
      ? [
          tapPanMethod(core, "resolveBatch", (_args, _result, duration) => {
            add("coreMs", duration);
          }),
          tapPanMethod(
            core,
            "resolveNextCandidate",
            (_args, result, duration) => {
              if (result !== undefined) add("scanned");
              add("scanMs", duration);
            },
          ),
          tapPanMethod(core, "resolveRegion", (_args, _result, duration) => {
            add("resolved");
            add("resolveMs", duration);
          }),
          tapPanMethod(core, "composeWorldTile", (args, _result, duration) => {
            add("composed");
            add("compositionInclusiveMs", duration);
            if (phase !== "initial") {
              const key = JSON.stringify([phase, args[1], args[3], args[4]]);
              generationByTile.set(key, (generationByTile.get(key) ?? 0) + 1);
            }
          }),
          tapPanMethod(cache, "getCompatible", (_args, result, duration) => {
            add(result === undefined ? "cacheMiss" : "cacheHit");
            add("cacheMs", duration);
          }),
          tapPanMethod(backend, "presentRegion", (args) => {
            const region = args[0];
            if (
              typeof region !== "object" ||
              region === null ||
              !("bounds" in region) ||
              !("pixels" in region) ||
              !(region.pixels instanceof Uint8Array)
            )
              throw new Error("Invalid measured region.");
            const key = JSON.stringify(region.bounds);
            drawnTiles.set(key, (drawnTiles.get(key) ?? 0) + 1);
            add(`drawSize${Math.sqrt(region.pixels.length / 4)}`);
          }),
        ]
      : [];
    restore.push(
      tapPanMethod(renderer, "render", (_args, _result, duration) => {
        const currentVisible = visibleKeys(camera);
        const overlapping = [...currentVisible].filter((key) =>
          previousVisible.has(key),
        ).length;
        metrics.totalMs = duration;
        if (instrument) {
          metrics.tilesDrawnRepeatedly = [...drawnTiles.values()].filter(
            (count) => count > 1,
          ).length;
          metrics.maxDrawsPerTile = Math.max(0, ...drawnTiles.values());
        }
        frames.push({
          sequence: frames.length,
          phase,
          atMs: performance.now(),
          panX: camera.panX,
          visible: currentVisible.size,
          newlyVisible: currentVisible.size - overlapping,
          overlapping,
          metrics,
          snapshot: renderer.diagnostics.getSnapshot(),
        });
        metrics = {};
        drawnTiles = new Map();
        previousVisible = currentVisible;
      }),
    );
    try {
      do {
        renderer.render({
          quality: startsInteractive ? "interactive" : "full",
        });
      } while (renderer.hasPendingRender);
      const initialSnapshot = renderer.diagnostics.getSnapshot();
      const initialRetention = retainedPixels(renderer);
      frames.length = 0;
      phase = "pan";
      const trace: unknown = Reflect.get(globalThis, "__reveriePanTrace");
      if (typeof trace === "function") await trace("start");
      const startedAt = performance.now();
      for (let tick = 0; tick < 60; tick += 1) {
        // Three input events before one animation frame exercise actual coalescing.
        for (let event = 0; event < 3; event += 1) {
          camera.panBy(4 / 3 / zoom, 0);
          session.requestViewRender("interactive");
        }
        await nextFrame();
      }
      const panElapsedMs = performance.now() - startedAt;
      const panSnapshot = renderer.diagnostics.getSnapshot();
      const panRetention = retainedPixels(renderer);
      phase = "hold-interactive";
      if (typeof trace === "function") await trace("stop");
      await drain(renderer);
      phase = "settle";
      session.requestViewRender("full");
      await nextFrame();
      await drain(renderer);
      if (versions() !== initialVersions)
        throw new Error("Pan mutated a Tile revision.");
      if (
        instrument &&
        frames.some((frame) => (frame.metrics.composed ?? 0) > 0) &&
        !frames.some((frame) => (frame.metrics.lodCalls ?? 0) > 0)
      )
        throw new Error(
          "The LOD measurement hook did not observe the expected minification work.",
        );
      cases.push({
        zoom,
        startsInteractive,
        panElapsedMs,
        initialSnapshot,
        panSnapshot,
        retention: { initial: initialRetention, pan: panRetention, final: retainedPixels(renderer) },
        finalSnapshot: renderer.diagnostics.getSnapshot(),
        maxGenerationPerVariant: Math.max(0, ...generationByTile.values()),
        generationByTile: Object.fromEntries(generationByTile),
        frames,
      });
      console.info(
        `Pan profile completed zoom=${zoom}, startsInteractive=${startsInteractive}, render calls=${frames.length}`,
      );
    } finally {
      session.dispose();
      for (const dispose of restore.reverse()) dispose();
      renderer.dispose();
      Reflect.deleteProperty(globalThis, "__reveriePanLod");
      canvas.remove();
    }
  }
  return {
    fixture: {
      tileSize: TILE_SIZE,
      worldSize: WORLD_SIZE,
      width: WIDTH,
      height: HEIGHT,
      layers: 2,
      allocatedTiles: 512,
      panTicks: 60,
      requestsPerTick: 3,
      cssPixelsPerTick: 4,
      pixelRatio: 1,
    },
    cases,
  };
}

/** Counts retained references and unique pixel buffers without scanning pixels. */
function retainedPixels(renderer: CanvasRenderer): Record<string, number> {
  const presentation = requireObject(renderer, "presentationState");
  const retained: unknown = Reflect.get(presentation, "cachedRegions");
  if (!(retained instanceof Map)) throw new Error("Missing presentation cache.");
  const buffers = new Set<Uint8Array>();
  for (const entry of retained.values()) {
    const cached: unknown = entry;
    if (typeof cached !== "object" || cached === null) throw new Error("Invalid cached result.");
    const region = requireObject(cached, "region");
    const pixels: unknown = Reflect.get(region, "pixels");
    if (!(pixels instanceof Uint8Array)) throw new Error("Invalid retained pixels.");
    buffers.add(pixels);
  }
  return {
    entries: retained.size,
    uniquePixelBuffers: buffers.size,
    pixelBytes: [...buffers].reduce((total, pixels) => total + pixels.byteLength, 0),
  };
}

/** Fails loudly if the observed private runtime shape changes. */
function requireObject(owner: object, key: string): object {
  const value: unknown = Reflect.get(owner, key);
  if (typeof value !== "object" || value === null)
    throw new Error(`Missing profiling object: ${key}`);
  return value;
}

/** Counts geometrically visible allocated coordinates independently of renderer counters. */
function visibleKeys(camera: Camera): Set<string> {
  const view = camera.visibleWorldRect({ width: WIDTH, height: HEIGHT });
  const keys = new Set<string>();
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1) {
      if (
        x * TILE_SIZE < view.x + view.width &&
        (x + 1) * TILE_SIZE > view.x &&
        y * TILE_SIZE < view.y + view.height &&
        (y + 1) * TILE_SIZE > view.y
      )
        keys.add(`${x}:${y}`);
    }
  return keys;
}

/** Waits for the scheduler's previously requested animation frame to execute. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Lets actual scheduler continuations finish without faking Core's clock or budgets. */
async function drain(renderer: CanvasRenderer): Promise<void> {
  let count = 0;
  while (renderer.hasPendingRender) {
    if (++count > 2000)
      throw new Error(
        "Pan profile failed to settle after 2000 animation frames.",
      );
    await nextFrame();
  }
}
