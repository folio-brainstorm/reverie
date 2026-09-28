# Rêverie V1 performance baseline

Captured 2026-09-28 on Windows 10 (19045), Intel i5-8250U (8 logical CPUs),
7.9 GiB RAM, Node 24.18.1, pnpm 11.18.0, headless Chromium 153.0.8010.12.
This is a comparison baseline, not a cross-machine speed target. Raw compact
measurements are in [V1_CORE_BASELINE.json](V1_CORE_BASELINE.json) and
[V1_RENDER_BASELINE.json](V1_RENDER_BASELINE.json).

## Fixture and method

- Raster and Stroke: 256-pixel Tiles, opaque size-1 `PixelBrush` at default 0.25 spacing. Each small benchmark uses two warmups and seven measured trials; times below are mean / p95.
- World composition: dense 512×512 area, four Tiles per layer, 1/2/4 layers. A fresh `RenderingCore` and result cache are used for each cold trial. Diagnostics timings are enabled. Output is canonical, including at scale 0.25.
- Browser rendering: existing two-layer 4096×4096 opaque/translucent fixture, 512 allocated source Tiles, 768×512 viewport, DPR 1. Each Pan has 60 RAF ticks, three requests per tick and 4 CSS pixels of movement per tick. Initial coverage is complete before Pan. Cases start from either full or interactive quality. The benchmark ran three instrumented times and two probe-disabled times; the checked-in compact result is the final matched pair. Counts below are from that pair. Raw per-frame files stay under ignored `results/`.
- Browser timers measure synchronous `renderer.render()` calls and the manually drained cold coverage. They exclude deferred browser paint. Internal per-Tile probes increase overhead; probe-disabled timings are listed separately. Chromium used software Canvas presentation, not a representative GPU.

## Raster and Stroke

| Raster operation         |                                   Work | Tiles / raw bytes | Mean / p95 ms |
| ------------------------ | -------------------------------------: | ----------------: | ------------: |
| Allocate 16 Tiles        |                 16 single-pixel writes |        16 / 4 MiB |   3.73 / 5.79 |
| Repeated writes          |               4,096 pixels in one Tile |       1 / 256 KiB |   2.37 / 2.77 |
| Cross-Tile size-3 stamps | 512 stamps over two vertical Tile rows |         8 / 2 MiB |  6.12 / 10.46 |

Repeated writes advanced the touched Tile revision from 1 to 4,097. The
cross-Tile case exercises both horizontal and vertical boundaries.

| Stroke                         | Input → processed → stamps | Touched Tiles | Processing mean / p95 ms | Raster write mean / p95 ms | Total mean / p95 ms |
| ------------------------------ | -------------------------: | ------------: | -----------------------: | -------------------------: | ------------------: |
| Short, 0.5 → 1.4               |                  2 → 2 → 4 |             1 |              0.16 / 0.32 |                0.25 / 0.48 |         0.41 / 0.80 |
| Medium, 768 world units        |           33 → 769 → 3,073 |             4 |             7.62 / 15.20 |                2.75 / 4.74 |       10.38 / 18.78 |
| Long sparse, 4,096 world units |         9 → 4,097 → 16,385 |            17 |             7.28 / 11.64 |              11.21 / 12.53 |       18.49 / 21.42 |

Processing includes `addSample()` and `end()`; writing drains actual stamp
commands through `PixelBrush.stamp()`. Short and medium timings are sensitive to
JIT and timer noise. Across three independent Core invocations, long-sparse
mean ranged from 13.61 to 32.15 ms despite identical work counts; future
comparisons should use multiple runs and check counts first. This Node path is
not browser pointer-event latency.

## World composition

The table measures a cold four-Tile canonical request. Contributor pixels are
read from Core diagnostics. Composition duration includes contributor lookup,
sampling/downsample and blend; it cannot be added to total time.

| Layers / input Tiles | Scale | Output pixels | Contributor pixels | Mean / p95 total ms |
| -------------------- | ----: | ------------: | -----------------: | ------------------: |
| 1 / 4                |     1 |       262,144 |            262,144 |       14.75 / 18.15 |
| 1 / 4                |  0.25 |        16,384 |            262,144 |       18.97 / 22.79 |
| 2 / 8                |     1 |       262,144 |            524,288 |       41.42 / 48.38 |
| 2 / 8                |  0.25 |        16,384 |            524,288 |       40.07 / 48.16 |
| 4 / 16               |     1 |       262,144 |          1,048,576 |      87.04 / 114.18 |
| 4 / 16               |  0.25 |        16,384 |          1,048,576 |     122.83 / 155.39 |

Each cold request produced four regions and four result-cache insertions. The
scale-0.25 canonical request still composes source contributor pixels before
filtering, explaining why output size alone does not predict total cost.

## Browser cold coverage and Pan

Cold elapsed time below is probe-disabled and includes a synchronous harness
loop that drains all progressive batches. In normal Web use these batches are
scheduled across frames. Cold p95 is the instrumented **per-call** time; one
whole cold run per zoom was captured in each browser invocation.

| Initial quality / zoom | Visible Tiles | Cold regions / LOD calls | Cold elapsed ms / call p95 ms | Pan new Tiles | Pan resolves / compositions / LOD calls | Pan uploads / draws | Pan mean / p95 ms; no-probe mean ms |
| ---------------------- | ------------: | -----------------------: | ----------------------------: | ------------: | --------------------------------------: | ------------------: | ----------------------------------: |
| Full / 1               |             8 |                    8 / 0 |                    176 / 28.9 |             2 |                            10 / 10 / 20 |            10 / 488 |                      2.1 / 9.8; 2.8 |
| Full / 0.5             |            28 |                  24 / 24 |                    268 / 15.7 |             8 |                            32 / 32 / 64 |          32 / 1,687 |                      2.8 / 9.7; 3.4 |
| Full / 0.25            |           104 |                  96 / 96 |                  1,153 / 15.9 |            16 |                         111 / 111 / 222 |         111 / 5,905 |                     5.6 / 11.5; 6.1 |
| Full / 0.0625          |           256 |                256 / 256 |                  2,993 / 15.6 |             0 |                         256 / 256 / 512 |        256 / 15,616 |                    9.1 / 12.4; 10.9 |
| Interactive / 0.25     |           104 |                 96 / 192 |                    378 / 11.4 |            16 |                            16 / 16 / 32 |          16 / 5,890 |                     3.1 / 10.8; 4.1 |
| Interactive / 0.0625   |           256 |                256 / 512 |                    922 / 10.4 |             0 |                           **0 / 0 / 0** |      **0 / 15,360** |                      3.7 / 4.9; 3.2 |

Cold canonical composition processed 1,048,576 / 3,145,728 / 12,582,912 /
33,554,432 contributor pixels at zoom 1 / 0.5 / 0.25 / 0.0625. The interactive
0.25 and 0.0625 cold starts generated 96 and 256 approximate Tiles instead;
their approximate composition counts were 49,152 and 8,192 pixels. Cold LOD
probe time for the four full-quality zooms was 0 / 33.7 / 63.5 / 161.3 ms;
these spans are nested inside total time.

All six Pan cases accepted 180 view requests, executed 60 scheduled views and
issued 60 Core requests. Pan source-Tile scans were about 24k–31k candidate
steps, depending on cancellation. Core cache hits during Pan were zero because
the renderer skipped results already retained for presentation; cache misses
equalled the newly resolved output. The stable interactive 0.0625 control had
no newly visible Tiles, no Core resolve, no composition, no LOD generation and
no uploads in either instrumented run. Other Pan cases generated a variant
once per coordinate at most; `maxGenerationPerVariant` was 1.

Cancellation is bounded: the full-quality 0.0625 case completed 20 of 60
requests during Pan and cancelled 40 superseded requests. After input stopped,
all cases drained, ended with no pending request and completed the final full
quality pass. Starting interactive at 0.25 and 0.0625 required 256 canonical
Tiles during settled refinement; this is useful completion work, not repeated
interactive generation. In the full-quality 0.0625 case Pan had generated the
required interactive variant and settled refinement generated zero new Tiles.

## Memory sanity and limits

The Core result cache budget was 32 MiB. Final cache occupancy across the six
cases ranged from 0.27 MiB to 15.38 MiB, below budget. Presentation retention
grew from initial coverage to at most 512 region entries across Pan and settled
refinement; this is bounded by the fixture's 256 source coordinates and two
quality variants. After each renderer `dispose()`, observed presentation entries
and Core cache bytes were both zero. Raster raw storage remained 128 MiB for the
two 4096×4096 layers; Tile revisions were unchanged by Pan.

These are retained-resource counts, not exact process heap or GPU allocations.
The benchmark does not force GC and cannot infer a precise leaked-byte rate.
Three instrumented Pan runs showed timing variation but the stable cached path
remained at zero generation and all runs converged.

## Reproduce

From the repository root after `pnpm build`:

```powershell
pnpm --filter @reveriejs/demo exec node profiling/RunV1CoreBaseline.mjs
$env:PAN_PROFILE_RESULTS = "./results/v1-repeat/"
pnpm --filter @reveriejs/demo exec node profiling/RunPanProfile.mjs
$env:PAN_PROFILE_INSTRUMENT = "false"
pnpm --filter @reveriejs/demo exec node profiling/RunPanProfile.mjs
pnpm --filter @reveriejs/demo exec node profiling/SummarizeV1Baseline.mjs v1-repeat
```

The two JSON files in this directory are regenerated by those commands. Raw
browser traces, frame records and prior investigation material remain in the
ignored `results/` directory. This baseline found no stable severe interactive
failure, repeated cached generation, unbounded retained resources or failure to
settle. Cold low-zoom generation, broad candidate traversal and repeated draw
submission are comparison targets for later releases, not V1 release blockers.
