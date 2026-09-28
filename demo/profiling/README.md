# Pan investigation harness

This directory is an isolated diagnostic tool. It changes no engine, renderer,
cache policy, scheduler, dependency, or normal demo entry point. The investigation
uses the current working tree, including its pre-existing uncommitted changes.

From the repository root, with its declared Node and pnpm versions:

```powershell
pnpm build
pnpm --filter @reveriejs/demo exec tsc -p profiling/tsconfig.json
pnpm --filter @reveriejs/demo exec node profiling/RunPanProfile.mjs
pnpm --filter @reveriejs/demo exec node profiling/SummarizePanProfile.mjs
```

The runner uses the already installed Vite and Playwright dependencies, binds
127.0.0.1:5187, launches headless Chromium, and closes both resources on exit.
It serves a blank page rather than the demo UI. Fixture creation may take several
seconds. No brush calls or Raster writes occur during the recorded Pan.

The workload is a dense, two-layer 4096×4096 World with 256×256 source Tiles,
768×512 backing/CSS pixels, and DPR 1. The session is deliberately not attached
to DOM drawing listeners or ResizeObserver. It uses its real default RAF
scheduler. Each of 60 animation ticks submits three camera/view updates totaling
4 CSS pixels, exactly the camera/request portion of the demo's Pan handler.
Afterward the pointer is held still until interactive work finishes, then a full
quality request simulates release. Initial rendering and fixture writes are not
included in Pan statistics. Every source Tile identity/revision is checked after
each scenario.

Scenarios 0–3 start with a completed full-quality view at zoom 1, 0.5, 0.25,
and 0.0625. Scenarios 4–5 start directly with interactive output at zoom 0.25
and 0.0625, isolating the effect of canonical results already in presentation
storage. They are diagnostic controls, not proposed production behavior.

Disable internal method probes to estimate instrumentation overhead:

```powershell
$env:PAN_PROFILE_INSTRUMENT = "false"
pnpm --filter @reveriejs/demo exec node profiling/RunPanProfile.mjs
pnpm --filter @reveriejs/demo exec node profiling/SummarizePanProfile.mjs pan-profile-baseline
```

Select a single scenario in a fresh browser process and capture browser-side work:

```powershell
$env:PAN_PROFILE_CASE = "3"
$env:PAN_PROFILE_TRACE = "true"
pnpm --filter @reveriejs/demo exec node profiling/RunPanProfile.mjs
pnpm --filter @reveriejs/demo exec node profiling/SummarizePanProfile.mjs pan-profile-baseline-case3
```

Use case 5 for the tiny-zoom interactive-start control. These environment
variables affect only the diagnostic runner. Remove them from the shell or set
CASE=-1, TRACE=false, INSTRUMENT=true to return to the default full comparison.

`results/*.json` contains raw per-render snapshots and summaries; compressed
Chrome traces are `trace-case*.json.gz`. Unavailable internal measurements in
baseline summaries are `null`, not zero. Source images are synthetic, not user
documents.

Measurement details:

- `scanned`: allocated source coordinates advanced, including each World layer.
- `resolved`: calls into Core's per-coordinate resolution, including result hits.
- `composed`: calls to World composition. In this opaque fixture each produces
  one pixel buffer; the public World generation-counter deltas confirm it.
- `lodCalls`: actual source filtering calls; two contributor filters per World
  preview Tile. This is different from the number of final LOD Tile results.
- `cacheHit/cacheMiss`: Core result-cache lookups. Presentation results skipped
  before Core do not increment either counter.
- `newlyVisible/overlapping`: geometric changes in the allocated visible set;
  overlap alone does not guarantee that presentation's exact-size reuse accepts
  a result.
- `coreMs`, `compositionInclusiveMs`, `lodMs`, `cacheMs`, and `scanMs` are nested
  measurements. Do not sum them. Output allocation occurs inside composition
  and filtering, rather than in an independent pixel-generation stage.
- `totalMs` measures the renderer call, excluding snapshot collection. It is
  not end-to-end display latency. Public presentation time includes clear,
  upload, and draw submission, not all deferred browser work.
- Runtime probes temporarily wrap existing methods only in the profiling page.
  A Vite transform wraps the built downsample function in memory so approximate
  World sampling is counted too. No source or dist module is patched on disk.
- The per-Tile timers perturb absolute timings; use counts, the probe-disabled
  run, and the browser trace together. Headless traces here used software
  presentation; they are not measurements of the user's GPU.

See [REPORT.md](REPORT.md) for findings, evidence, and limitations.
# Pan fix follow-up

Set `PAN_PROFILE_RESULTS=./results/final-fix/` to preserve the original investigation
data while recording the fix. This path is relative to `RunPanProfile.mjs`.
Retention snapshots count presentation-cache entries and unique referenced pixel
buffer bytes after initial rendering, Pan, and final refinement. They exclude
Canvas surfaces and Core-only entries. See
`renderers/canvas-renderer/PAN_REUSE_FIX.md` for the final comparison and timing
limitations. The summary now includes the first completed Pan frame and the last
15 calls; those last calls are not automatically a warmed-up window, so check
generation counts before interpreting them as steady state.
