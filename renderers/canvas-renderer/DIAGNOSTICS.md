# Renderer diagnostics

`CanvasRenderer` exposes grouped, detached diagnostic snapshots through
`renderer.diagnostics.getSnapshot()`. The same property is available at
`reverie.renderer.diagnostics` when using `ReverieCanvas`.

```ts
import { CanvasRenderer } from "@reverie/canvas-renderer";

const renderer = new CanvasRenderer({ canvas, camera, raster });
renderer.render();
const snapshot = renderer.diagnostics.getSnapshot();
console.log(snapshot.tiles.renderedCount, snapshot.regions.presentedCount);
```

Cheap counters are always collected. The `tiles` and `regions` sections describe
the latest Core batch or Canvas `render()` call, as named by each field. The
`progressive` section contains lifetime request counters. A snapshot does not
change when later renders run, and its nested objects are frozen.

High-resolution timing and rolling statistics are optional:

```ts
const renderer = new CanvasRenderer({
  canvas,
  camera,
  raster,
  diagnostics: { timings: true },
});
```

Timing metrics contain `current`, `average`, and `max` durations in milliseconds
over the latest 60 successful batches or calls. Core stage durations include
their nested work: Raster and World composition measurements can include LOD
processing. Canvas `presentationDurationMs` includes upload and draw work.
Absent timing sections mean timing was not enabled or no sample exists yet.

The Core also exposes `getDiagnosticsSnapshot()` for platform-independent
measurements. Its existing `getLastDiagnostics()` remains available for callers
using the earlier flat batch metrics. FPS and Web drawing scheduler statistics
belong to the Web/Session lifecycle and are not reported here.
