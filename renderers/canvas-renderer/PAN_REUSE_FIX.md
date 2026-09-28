# Pan result reuse fix

After a full render, interactive Pan requested a smaller output while
`PresentationState` retained only the larger canonical result for each coordinate.
Core could reuse the smaller pixels, but the renderer could not skip their
resolution. Reprojection could also draw the previous preview, the canonical
fallback, and the preview again. With more than 128 candidates, moving the camera
restarted the same prefix instead of progressing through the remaining Tiles.

## Implementation

- `PresentationState` retains at most two results per geometric coordinate: the
  regular result and the most recent interactive output. Interactive Raster
  pixels are canonical, so retention slots follow request quality; compatibility
  separately checks pixel result class and exact output size.
- Canonical pixels can satisfy an interactive request at the same output size.
  Approximate pixels cannot satisfy a canonical request.
- Projection selects one result per visible coordinate: compatible exact output
  first, then canonical fallback, then higher resolution within a result class.
  `CanvasRenderer` draws that selection once when the camera changes. Newly
  generated results may still replace fallback pixels during progressive work.
- Every completed batch retains its pixels before presentation, including fully
  transparent output. Cancellation discards request progress but preserves these
  results for subsequent `skipTiles`. Transparent partial output still does not
  immediately erase the previous frame; completion reconciles visible coverage.
- Source invalidation, completed removals, and spatial eviction remove all
  relevant slots. Zone counters count coordinates rather than variants.

The Core cache key, sampling algorithm, batch budgets, and canonical pixel
semantics are unchanged by this fix. Work remains inside the existing renderer
and progressive request architecture.

## Regression coverage

Two regressions failed before implementation: smaller preview reuse returned no
result, and continuous Pan over 129 coordinates never completed. They now pass.

The deterministic batch test freezes the budget clock and tests both World and
Raster sources. After full output has settled, two moving interactive requests
finish 129 coordinates with one obsolete-request cancellation. Subsequent Pan
and reverse Pan resolve zero regions and draw each visible Tile once. Returning
to full quality reuses canonical pixels without uploads.

Additional tests cover bounded variant retention, negative coordinates and
half-open eviction boundaries, source revision changes, transparent completed
pixels surviving cancellation, removal of all variants, and canonical versus
approximate identity. Browser regressions compare translucent pixel output with
a fresh renderer at zoom 1, 0.5, and 0.25, including settled refinement.

## Validation

- Commit-wide `pnpm typecheck`: passed.
- Commit-wide `pnpm build`: passed.
- Commit-wide `pnpm test`: 1,411 tests passed (983 Core/integration, 134 Web,
  93 Canvas renderer, and 201 exporter). This command does not run browser tests.
- `pnpm --filter @reveriejs/canvas-renderer typecheck`: passed.
- `pnpm --filter @reveriejs/canvas-renderer test`: 93 passed.
- `pnpm --filter @reveriejs/canvas-renderer build`: passed; rebuilt for profiling.
- Targeted Chromium and Firefox pixel/refinement tests: 8 passed.
- Full browser suite: 22 passed, 4 failed. The failures are the previously
  observed old-pixels-until-completion assertion in both browsers, Firefox's
  minified intersection channel bound, and Firefox's fixed presentation pixel
  hash. Their assertions were not weakened or updated by this fix. The final
  projection simplification was subsequently checked with the targeted browser
  tests; the full suite was not repeated after that simplification.
- `pnpm --filter @reveriejs/demo exec tsc -p profiling/tsconfig.json`: passed for
  local instrumentation.

Production changes are confined to this package and its private implementation;
no public entry point, dependency, or shared contract changes were introduced.
The workspace already contained uncommitted Core and renderer changes before
this fix. Those changes are the baseline, not part of this fix's scope.
The commit bundles those directly required result-cache and approximate-preview
dependencies with the Pan fix so it can be checked out independently. The local
profiling artifacts and unrelated `.gitignore` edit are excluded.

## Measurement method and remaining costs

The local `demo/profiling/` harness uses the same immutable two-layer 4096×4096
World, 256-pixel Tiles, 768×512 viewport, and 60 Pan ticks as the investigation.
Each tick submits three camera requests before RAF. Initial full rendering is
excluded. Instrumented and probe-disabled runs are separate. All source Tile
revisions are checked for changes. The final runs use a separate results
directory so the investigation data is preserved.

Cold generation and cached Pan must be assessed separately. The fixed renderer
can finish previews previously starved during movement, so it may perform more
useful generation during the same 60 ticks. Fewer draw calls alone do not prove
a proportional CPU or FPS improvement. The last 15 frames are reported separately
when they contain no new generation.

Retention measurements count unique pixel buffers referenced by the presentation
cache. These buffers are shared with Core results, not copied into the cache.
They exclude Canvas surfaces, Core-only entries, and browser/GPU memory. Two
slots bound variants per coordinate, but spatial retention still determines the
number of coordinates and remains an important memory consideration.

Remaining costs include source-area filtering for cold previews, all-allocated
Tile traversal, full-resolution canonical composition, and warm work after
interaction. The fix does not claim to eliminate those costs or every possible
cause of Pan stutter.

## Measured results

Instrumented frame 42, before versus final implementation (all these frames have
zero new composition, downsampling, or uploads):

| Zoom | Visible coordinates | Resolved before → after | Draws before → after |
| --- | ---: | ---: | ---: |
| 1 | 8 | 6 → 0 | 20 → 8 |
| 0.5 | 28 | 20 → 0 | 68 → 28 |
| 0.25 | 96 | 80 → 0 | 256 → 96 |
| 0.0625 | 256 | 128 → 0 | 512 → 256 |

In the tiny canonical-start case, the old implementation generated only 128
previews during Pan and completed no requests (59 cancellations and one pending
request). The final instrumented run generated all 256 previews and first
completed on Pan frame 38: 23 completed requests, 37 cancellations, none pending
at the end. Each coordinate/output/class was generated at most once. The final
probe-disabled run first completed on frame 52, with 9 completed requests and 51
cancellations. These cold cancellations remain budget-dependent, but no longer
starve the second half of the viewport. Both final interactive-start control
runs completed all 60 tiny requests without cancellations or new generation.

Timing did **not** improve uniformly. The probe-disabled 60-call renderer mean
(including cold work) was:

| Zoom | Before, ms | Final, ms |
| --- | ---: | ---: |
| 1 | 2.16 | 2.57 |
| 0.5 | 2.50 | 2.85 |
| 0.25 | 5.38 | 6.14 |
| 0.0625 | 6.63 | 12.01 |

Even the common last eight calls, which contain zero new pixels in both runs,
were mixed: 1.12→1.65, 1.58→1.25, 3.18→3.09, and 4.59→5.91 ms respectively.
The instrumented tiny last-eight mean was 5.68→4.41 ms. These are separate
historical/final runs, not randomized same-session A/B trials. The instrumentation,
runtime variability, extra candidate traversal after the old prefix limit is
removed, and additional retention bookkeeping preclude a claim of consistent
CPU/FPS improvement. The confirmed benefit is reduced repeated work and resumed
coverage progress; the remaining performance problem requires further measurement.

Tiny presentation retention at the end of Pan is 512 results / 278,528 pixel
bytes: 256 canonical buffers (262,144 bytes) and 256 preview buffers (16,384 bytes).
At zoom 1/0.5/0.25, end-of-Pan retention is respectively 18/56/206 results and
2,752,512 / 2,097,152 / 1,685,504 pixel bytes. Warm/refinement work increases final
retention, reaching 16,121,856 bytes in the zoom-1 fixture. These are references
to shared results, not a measure of incremental process memory.

Raw final results and summaries are in the locally ignored directory
`demo/profiling/results/final-fix/`; original investigation results remain in
`demo/profiling/results/`. Reproduce after building the current renderer:

```powershell
$env:PAN_PROFILE_RESULTS = './results/final-fix/'
$env:PAN_PROFILE_INSTRUMENT = 'true'
node demo/profiling/RunPanProfile.mjs
node demo/profiling/SummarizePanProfile.mjs final-fix/pan-profile
$env:PAN_PROFILE_INSTRUMENT = 'false'
node demo/profiling/RunPanProfile.mjs
node demo/profiling/SummarizePanProfile.mjs final-fix/pan-profile-baseline
```
