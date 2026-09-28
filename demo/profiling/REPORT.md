# Reverie Pan investigation

分析对象是当前工作树，而非仅 HEAD；HEAD 为
`7e3f03f06b28a04169fba73f868751709709c32f`，调查开始时已经存在 Core result cache、World preview 和 Renderer 的未提交修改。此次只新增 `demo/profiling/`，未修改这些实现。

## Observed behavior

**在本次复现场景中，稳定 Pan 的主要重复工作是 resolve 与 presentation，未发现相同 Tile、相同内容、相同 LOD 每帧重新生成像素。** 但 full → interactive 的首次转换会生成新的 LOD；低 zoom 下的 presentation 缓存策略又使这种新结果无法作为下一帧的 generation skip，造成重复查找、重复 draw 和 continuation 饥饿。

最强的证据来自 zoom=0.0625：整个 4096×4096 World 始终都在视口内，新暴露 Tile 为 0。60 次实际 render 请求中，完成 0、取消 59，最后一个仍 pending。稳定帧没有 compose、pixel generation、LOD generation 或 upload，却发生 128 次 resolve、128 次 Core cache hit 和 512 次 draw。

对照场景从相同 output size 的 interactive 结果开始，60 次请求全部完成，resolve/compose/LOD generation 全部为 0，256 个 Tile 各 draw 一次。两场景都没有内容修改或 zoom 修改。

## Actual render path during Pan

| 阶段 | 实际调用及行为 |
| --- | --- |
| 输入 | [PaintingWorkspace.handlePanMove](../src/PaintingWorkspace.tsx#L944)：`camera.panBy(-screenDelta / zoom)`，随后显式 `requestViewRender("interactive")`；[finishPan](../src/PaintingWorkspace.tsx#L968) 请求 `full`。 |
| Camera | [Camera.panBy/setPan](../../core/src/core/camera/Camera.ts#L125) 只更新 pan 数值。Camera 没有自动 render、content dirty 或 camera revision 通知。 |
| Facade/Session | [ReverieCanvas.requestViewRender](../../web/src/facade/ReverieCanvas.ts#L405) → [CanvasDrawingSession.requestViewRender](../../web/src/session/CanvasDrawingSession.ts#L246)：保存最新 quality、启用 prefetch、标记 view request queued。 |
| 调度 | [DrawingScheduler.requestRender/scheduleFrame](../../web/src/scheduler/DrawingScheduler.ts#L237) 合并为一个待执行 RAF。[handleFrame](../../web/src/scheduler/DrawingScheduler.ts#L64) 调用 Session 的 `onRender`。 |
| Renderer | [CanvasRenderer.renderPass](../../renderers/canvas-renderer/src/canvas/CanvasRenderer.ts#L213)：求 bounded viewport、采样运动速度、选择 coverage/quality/output size，比较 viewport key，重投影旧结果，再判断 continuation。 |
| 增量复用 | `PresentationState.getReusableRegions` → `skipTiles`；Core 跳过被 Renderer 接受的结果。[调用处](../../renderers/canvas-renderer/src/canvas/CanvasRenderer.ts#L350)。 |
| Tile traversal/resolve | [RenderingCore.createWork](../../core/src/core/rendering/RenderingCore.ts#L359) 建立各 layer 的 allocated-Tile iterator；[resolveBatch](../../core/src/core/rendering/RenderingCore.ts#L452) 遍历、去重、裁剪、跳过 cached coordinates，再调 `resolveRegion`。 |
| Cache / pixels | [resolveRegion](../../core/src/core/rendering/RenderingCore.ts#L688) 先做 alpha relevance、signature 和 result-cache lookup。只有 miss 才 composition/downsample；缓存位于生成之前。 |
| Presentation | [PresentationState.append/applyProvisional](../../renderers/canvas-renderer/src/canvas/PresentationState.ts#L264) → `presentUnseenRegions` → [CanvasBackend.presentRegion](../../renderers/canvas-renderer/src/canvas/CanvasBackend.ts#L248)：复用 offscreen surface，必要时 `putImageData`，然后 `drawImage`。 |

Pan 请求 render 的原因是屏幕投影改变，需要清除旧位置并显示新位置。它不调用 `markSourceChanged` 或 `invalidate`；[sourceVersion](../../renderers/canvas-renderer/src/canvas/CanvasRenderer.ts#L670) 不会因此递增，Raster/Tile dirty bounds 也不会被修改或消费。

具体的状态变化是 Session 的 `isViewRenderQueued=true`、`isViewPrefetchActive=true`，以及 Scheduler 的 `hasPendingRender=true`。Renderer 通过不同的 viewport key 识别需要更新投影；Pan 不会把它的 `needsFreshRender` 设置为内容失效状态。

系统区分 source change 与 viewport change；quality/output resolution 也独立参与决策。没有独立的 pan-dirty / zoom-dirty 事件类型：pan、zoom、viewport 尺寸共同编码于 viewport key，移动速度另外采样。因此“zoom 没变”不等于“有效输出 LOD 没变”：Pan 开始时 quality 改为 interactive，coverage pressure 还可能再降一档。

## What gets recomputed

主测量第 42 次 Pan render（1-based），所有场景当帧新暴露 Tile 均为 0：

| zoom | 可见 Tile | A：draw | B：resolve | C：compose | D：新 pixel buffer | E：新 LOD Tile | Core hit / miss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 8 | 20 | 6 | 0 | 0 | 0 | 6 / 0 |
| 0.5 | 28 | 68 | 20 | 0 | 0 | 0 | 20 / 0 |
| 0.25 | 96 | 256 | 80 | 0 | 0 | 0 | 80 / 0 |
| 0.0625 | 256 | 512 | 128 | 0 | 0 | 0 | 128 / 0 |

全部 upload=0；后台通过 `lastValidatedPixels === region.pixels` 复用 surface，不需要重新比较 RGBA 或上传。**A/B 与 C/D/E 明确不是同一回事。**

```text
Pan frame #42, zoom=0.0625
visible:                  256
newly visible:              0
still visible:           256
presentation generation skip: 0
source coordinates scanned:128
resolved:                 128
composed:                   0
pixel-generated Tiles:      0
LOD-generated Tiles:        0
Core result hit / miss: 128 / 0
draw / upload:          512 / 0
Core:                    0.9ms
  cache lookup:          0.2ms (included in Core)
composition / LOD:       0 / 0ms
presentation:            3.5ms
total renderer call:     5.5ms
```

正常完成的 Pan 请求会重新扫描全部 512 个已分配 source Tile（256 coordinates × 2 layers），即使没有像素要生成。tiny 场景每帧只扫描前 128 个就撞上 candidate budget，下一帧又从头开始。`candidateCount` 不是 scanned count：它排除了 viewport 外、skip 与重复层坐标。

因此目前存在一部分 incremental viewport update：新进入的结果可以生成，旧结果可以 skip，离开的结果在 commit 时移除。但 traversal 本身不是增量的，并且下文的 cache variant 问题会阻断 B/C/D 场景中的有效 skip。

## LOD cache behavior

Core 的 [key](../../core/src/core/rendering/RenderingCore.ts#L693) 为：

```text
source object identity : tile x : tile y : source tile size : output tile size
World approximate 变体额外追加 :approximate
```

Raster signature 是 `tileId:revision`。World signature 是有序 layer id、visibility、opacity、blendMode，以及该坐标 contributor Tile 的 id/revision，见 [worldSignature](../../core/src/core/rendering/RenderingCore.ts#L793)。没有 viewport position、camera transform 或 viewport revision。默认 result-cache budget 为 32 MiB。

[viewportKey](../../renderers/canvas-renderer/src/canvas/CanvasRenderer.ts#L771) 确实包含 viewport rectangle、scale 和 pan；它控制正在进行的请求与 presentation projection，**并非 Tile pixel result 的 key**。`sourceRevision` 也是 Renderer 的内容失效标记，不随 Pan 改变。

全部四个主场景在 Pan 中 `validationFailures=0`、`evictions=0`；同一 `(coordinate, output size, result class)` 最多生成一次。后半段 zoom=0.25/0.0625 的 Core lookups 命中率均为 100%，没有重复 LOD generation。21 个现有 result-cache tests 也通过。

问题发生在上层：[PresentationState.getRegionKey](../../renderers/canvas-renderer/src/canvas/PresentationState.ts#L368) 只以 bounds 保存一个 region；[addWarmRegions](../../renderers/canvas-renderer/src/canvas/PresentationState.ts#L151) 优先保留较大 canonical；但 [getReusableRegions](../../renderers/canvas-renderer/src/canvas/PresentationState.ts#L115) 要求 output size 完全相等。

所以较小的 interactive region 虽已存在于 Core cache / visibleFrame，却不能进入 presentation 的 exact-size reusable set。Viewport 改变后，Renderer 又从 retained cache 获取较大的 canonical provisional region。这是两层复用策略之间的冲突，而不是 Core LOD key 被 Pan 错误失效。

## Performance measurements

环境：Windows x64，Intel i5-8250U，Node 24.18.1、pnpm 11.18.0、Chromium 153.0.8010.12。固定 dense 双层 World、256 source coordinates / 512 layer Tiles，768×512 viewport，DPR=1。60 个 RAF 输入 tick，每 tick 三次调用，总移动 240 CSS px。记录真实 scheduler/render calls；未模拟 Core 时钟。Fixture 写入与初始 full render 不计入 Pan。

主记录：[raw](results/pan-profile.json)、[summary](results/pan-profile-summary.json)。各阶段是 inclusive spans，不能相加重复计算。

| zoom | 可见 Tile 范围 | full → interactive 输出边长 / interactive LOD | 60 帧 compose / LOD 结果 | Core 命中率 | mean / p95 renderer ms | 完成 / 取消 / 仍 pending |
| --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 8 | 256 → 128 / L1 | 10 | 97.56% | 3.37 / 9.60 | 56 / 4 / 0 |
| 0.5 | 28 | 128 → 64 / L2 | 32 | 97.39% | 3.95 / 10.90 | 51 / 9 / 0 |
| 0.25 | 88–104 | 64 → 16 / L4 | 110 | 97.33% | 7.04 / 12.00 | 38 / 22 / 0 |
| 0.0625 | 256 | 16 → 4 / L6 | 128 | 97.95% | 8.97 / 15.00 | 0 / 59 / 1 |

最后两个场景具有 coverage pressure：Renderer 先 scale/2，Core 又因 interactive quality 使用 scale/2。所有场景 Pan 中 output size 始终不变。前两个场景单次 interactive 降档。

每个场景都有 180 个 view 输入请求、60 次 scheduler view execution、60 个 Core render request。相应输入请求/执行请求速率约为 175/58、103/34、104/35、176/59 次每秒。这里的速率是这个脚本在本机的实际 wall time，不代表真实鼠标设备采样率。公开 `coalescedCount` 为 179，因为它统计 queued **或 scheduler busy**，并非简单的 180−60=120 个同帧合并事件。

后 30 帧（zoom=0.25/0.0625 均无新可见 Tile、无新像素）的平均 renderer CPU 时间构成：

| 阶段 | zoom=0.25 | zoom=0.0625 |
| --- | --- | --- |
| 全部 Core | 1.60 ms，35.2% | 1.02 ms，17.1% |
| 其中 result lookup | 0.097 ms，2.1% | 0.190 ms，3.2% |
| 其中 iterator advance | 0.380 ms，8.4% | 0.077 ms，1.3% |
| compose / new buffers / downsample | 0 | 0 |
| presentation，包含 draw、clear、state | 2.19 ms，48.3% | 3.94 ms，66.3% |
| 其余 Renderer 协调、集合/投影管理 | 0.75 ms，16.5% | 0.98 ms，16.6% |
| 总计 | 4.53 ms | 5.94 ms |

`pixel generation` 不是独立 pipeline stage：buffer 分配发生在 composition 和 downsample 内。本 harness 记录了新结果数量/公开 generated bytes，但没有给分配与 blend 强行拆出虚假的独立百分比。

冷 miss 的结果不同：tiny Pan 总 composition-inclusive 时间 170.7 ms，其中 downsample 167.8 ms（98.3%）；128 个结果对两个 contributors 进行 256 次过滤，共读 16,777,216 个源像素。其余约 2.9 ms 包含 contributor lookup、小尺寸 blend 和 buffer 装配。稳态这些费用归零。

LOD 是否真正减少计算：

- [World interactive preview](../../core/src/core/rendering/composition/ComposeWorldPreviewTile.ts#L14)：每层先从 256×256 downsample，再在 output×output 上 blend。不是先合成完整 256×256。output=4 时两层只做 32 个 blend 像素操作，但仍过滤 131,072 个源像素。
- [World canonical](../../core/src/core/rendering/RenderingCore.ts#L861)：是完整 tileSize² composition → downsample → output；低 zoom 的 full/settle 请求仍承担完整合成成本。这是已确认的重要冷生成成本，但没有出现在上述稳定 Pan 帧。
- Raster-only source：直接过滤已有 Raster pixels，没有 World composition。源读取是 zero-copy view；结果另行分配。
- [DownsampleRgbaTile](../../core/src/core/rendering/region/DownsampleRgbaTile.ts#L11) 是 area filter，每次过滤仍遍历全部源 Tile 像素。输出面积减少不意味着过滤输入成本同比例减少。

“停住未松开”和 release 必须单独看：zoom=0.25 在 hold 阶段生成 146 个 warm preview，耗费约 347 ms renderer CPU；settle 阶段生成 160 个 canonical（其中 144 个 warm），耗费约 1,204 ms renderer CPU，分散到多个 RAF。不能把这些视口外生成混进正在拖动的 visible generation。

### 探针开销与浏览器后续工作

[关闭内部探针的同组测量](results/pan-profile-baseline-summary.json)中，四个主场景 renderer mean 为 2.16、2.50、5.38、6.63 ms；candidate/resolve probes 对绝对计时有影响。非探针测量中的内部计数标为 null，不冒充零。

独立新浏览器进程、tiny 场景：[canonical-start trace](results/trace-case3-summary.json) 中 59 次 `LayerTreeHost::DoUpdateLayers` 累计 209.3 ms，发生在浏览器主线程；另有 compositor 的 `Display::DrawAndSwap`。这些工作并未全部落在同步 `CanvasRenderer.render()` timer 内。trace 的 parent/child spans 与多线程时间不能相加为 frame time。

相同条件的 [interactive-start trace](results/trace-case5-summary.json)中该 browser span 为 272.8 ms。虽然请求完成数、draw/resolve 数量改善稳定复现，browser 后续成本与绝对耗时并不稳定按比例改善。独立 trace 运行的两组 renderer mean 为 6.05→4.38 ms，后半段仅为 3.36→3.21 ms；另一整组 baseline 的 tiny 对照甚至更慢。**因此不承诺固定 FPS 或时间收益。** Headless trace 使用了 SoftwareRenderer，无法据此宣布用户 GPU 就是瓶颈。

### Diagnostics 容易造成的误读

1. `regions.generatedCount`、`tiles.renderedCount` 基于返回的 regions 数量，包含 Core cache hits；不是 compose/new-pixel 次数。
2. `coverage.missingVisibleCount` 也直接累计 Core 返回 regions，因此可以在 128 hits / 0 misses 时显示 128。
3. `tiles.visibleCount` 是本次 batch 的候选可见数，忽略 generation skips，不能代表整个 viewport。
4. `compositionDurationMs` 包含 LOD。Preview helper 直接调用 downsample，绕过 `RenderingCore.downsamplePixels` 的计时，所以既有 `lodDurationMs.current` 会漏计 preview sampling。例如 tiny 的第一 Pan 帧实际进行了 4 次 contributor filters、约 10.3 ms，而公开 LOD ms 为 0。
5. Core 指标是最近 batch，Canvas 指标是最近 render call，另一些是 lifetime；warm-only/deferral 时不应把旧 batch 指标重复相加。

## Root cause candidates

| 用户提出的可能性 | 调查判断 |
| --- | --- |
| 1. LOD cache 因 Pan 错误失效 | 本 fixture 排除；无 validation failure/eviction，同变体最多生成一次。 |
| 2. LOD 生成自身昂贵 | 冷 miss 时成立；稳态无 generation，不能解释持续重复工作。 |
| 3. LOD 前仍全分辨率合成 | canonical 成立，interactive approximate 不成立。 |
| 4. viewport 变化把内容全标 dirty | 排除；source revision 和所有 Tile revisions 不变。 |
| 5. 缺乏 incremental viewport update | 部分成立；有 skip/retention，但 variant conflict 阻断 skip，候选扫描仍从头遍历。 |
| 6. request/cancellation storm | pointer 请求已有 RAF 合并；tiny 的 Core continuation cancellation/starvation 明确成立。 |
| 7. backend presentation 真正瓶颈 | 稳定 tiny renderer 调用中占比最大，而且有重复 draw；浏览器后续绘制还存在额外成本。不能外推为 GPU 唯一瓶颈。 |
| 8. 其他 | 两层缓存质量选择冲突、诊断指标含义混淆、hold/release 大量 warm work。 |

大文档还有一个未在本 fixture 触发的风险：[TileRenderSummaryCache](../../core/src/core/rendering/summary/TileRenderSummaryCache.ts#L4) 仅保留 1024 条 alpha summaries；超过容量可能在 result-cache lookup 之前重复扫描 alpha。当前仅 512 source Tiles，未证明该风险是用户问题根因。

## Confirmed root cause

已经用代码与对照测量共同确认下面这条链：

1. settled full 先把 canonical、高输出尺寸 region 存入 presentation cache。
2. Pan 开始切为 interactive，要求较低 output size。Core 生成一次、随后能正常缓存这个变体。
3. `addWarmRegions` 拒绝用低尺寸 approximate 覆盖高尺寸 canonical；geometric cache 只能存一个变体。
4. 下一帧 exact-size reuse 找不到 interactive region，无法 `skipTiles`，同一结果又进入 Core resolve。
5. viewport 变动时 `backend.present(visibleFrame)` 先画当前 interactive 结果；`getProvisionalRegions` 又带来 canonical，将部分坐标重画为 canonical；本帧 Core cache 返回 interactive 后第三次绘制同坐标。tiny 中前 128 个 Tile 每帧三次、另 128 个一次，共 512 次。
6. tiny 有 256 个候选，Core 每批上限 128。每次下一 RAF 的 viewport identity 变化都会取消上次 continuation，再从相同插入顺序重开请求。前 128 个反复 resolve，后 128 个直到停止 Pan 后才取得 interactive 结果。缓存没有丢，工作进度却没有有效延续。

这证明的是本当前工作树、该复现场景的原因。用户原始文档的图层/稀疏度、DPR、zoom、浏览器及缓存压力可能改变各项占比，不能用合成 fixture 的数值冒充现场录制。

## Recommended fix

以下仅为建议，未实施：

| 优先级 | 建议 | 收益依据 | 风险 |
| --- | --- | --- | --- |
| 1 | 为一个坐标明确选择一次本帧要显示的结果，避免 visible → canonical provisional → interactive 的反复覆盖；使 presentation generation reuse 能接受/保留目标 interactive 变体。 | 直接移除 3 次 draw 和 cached resolve；tiny 稳态 presentation 占 66.3%。 | 中等：必须保持 canonical/approximate 语义、partial frame 覆盖、边缘透明与移除正确性。 |
| 2 | 修复复用之后复测 continuation；让仍有效的已生成坐标跳过，或保留仍相关的未完成进度。 | tiny 59 cancellations、后半视口饥饿。对照已证明正确 reusable set 下 60/60 完成。 | 中等：不能呈现旧 source/旧 quality 的过期结果；不要简单扩大 batch budget。 |
| 3 | 独立限制 warm work 与 release 时的 canonical prefetch；预算需覆盖实际 Core 生成，不只检查进入 warm 前是否还有 2 ms。 | quarter hold/release 的绝大部分新增工作来自 warm。 | 低至中等：可能减少未来 Pan 预热收益，需要真实路径验证。 |
| 4 | 将 all-allocated traversal 与 visible-set 更新改为可增量/空间查询策略。 | 即使对照没有 resolve，仍扫描 512 source coordinates/帧。 | 较高：稀疏巨大 viewport 不能退化为枚举空 grid，应在前述修复后按规模再评估。 |
| 5 | 只有冷 generation 仍主导时再考虑 contributor LOD/mip 缓存、canonical 生成优化。 | preview 冷成本由全源 area filtering 主导。 | 较高：分层过滤与先合成后过滤不等价，alpha、blend mode、量化、内存预算必须验证。 |

不建议改 Core 的 viewport-independent key：当前 key 没有被这次调查证明错误。更高分辨率 canonical 是否可以直接满足较低 interactive 要求，是另一个可选政策，需要同时评估 Canvas 缩放成本与视觉语义；不能把 approximate 当作 canonical 用。

## Expected effect

可明确预期的是工作量，而非固定 FPS：对于完全重叠且结果已生成的 tiny 场景，目标是 `resolve 128→0`、`draw 512→256`、`cancel 59→0`，content generation 保持 0。对于 quarter 场景的第 42 帧，对照为 `resolve 80→0`、`draw 256→96`。

目标不是让 Pan 完全不 draw：Canvas 当前每次改变 projection 都要重画。进一步减少全部可见 Tile 的 draw 需要另一个 presentation 策略，风险和收益应另行测量。当前对照只证明缓存/质量策略对重复工作与取消有因果影响，没有实施或验证生产修复的最终速度。

## Risks / architectural implications

- 不能合并 canonical 与 approximate 的语义；保持已有像素正确性、层序、透明覆盖和完整帧移除规则。
- 同坐标多变体需要明确内存预算。Core result cache 有 byte budget；presentation region/surface retention 主要按空间范围，二者引用生命周期不同。
- `request identity` 与 `pixel identity` 应继续分离；取消旧 presentation 请求不应否定内容仍有效的生成结果。
- Profiler probes 改变 batch 时间预算边界，因此 completed/cancelled 小范围计数会波动；tiny 128 candidate 上限造成的 0 complete / 59 cancel 在所有 canonical-start 复跑中一致。
- 记录覆盖的是 camera → Session → scheduler → renderer 路径；未包含 React UI/SVG overlay 更新、真实 pointer dispatch 或用户现场 GPU。同步 render timer 也不包含完整的浏览器后续工作。
- 验证完成：`pnpm build`、`pnpm --filter @reveriejs/demo typecheck`；独立 profiling TypeScript 检查；四主场景、两缓存初态对照、关闭内部 probes 的整组复跑、两次独立浏览器 trace；现有 Core result-cache tests 21/21 通过。`pnpm --filter @reveriejs/demo test` 未运行：demo 没有 `test` 脚本；本次实际验证由隔离 browser profiling 和其中的 Tile revision/采样 hook 断言承担。
- 先前现有 browser suite 有 4 个断言失败，单独 Chromium presentation profile 也因 minified pixel hash 不同而在输出 stats 前失败。没有改变这些断言、修复或宣称整套 browser tests 已通过；它们不承担本报告的测量来源。

复现与数据字段说明见 [README.md](README.md)。
