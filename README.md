# Rêverie

这是一个使用 pnpm workspace 管理的多包项目：

- `core`：可独立构建的 TypeScript 核心包（`@reverie/core`）
- `renderer`：可扩展的渲染后端包（`@reverie/renderer`）
- `web`：浏览器运行时包（`@reverie/web`）
- `exporter`：导出包（`@reverie/exporter`）
- `demo`：独立的 Vite + React + TypeScript 示例应用
- `test`：独立的 Vitest 测试包，负责测试 `core`

## Raster Pixel API

`Raster` 使用 World Pixel Coordinate 提供稀疏像素读写；调用方无需接触内部的
`TileStore` 或 `Tile`：

```ts
import { Raster } from "@reverie/core";

const raster = new Raster();

raster.setPixel({ x: -1, y: 300 }, { r: 255, g: 0, b: 0, a: 255 });

raster.blendPixel({ x: -1, y: 300 }, { r: 0, g: 0, b: 255, a: 128 });

const color = raster.getPixel({ x: -1, y: 300 });
```

`setPixel` 会直接替换 RGBA8 像素；`blendPixel` 则使用 straight-alpha Source
Over 合成，并会忽略完全透明的源颜色。

## Paint Pipeline

`paintPixel` 将 Rasterizer 的 coverage、画笔颜色 Alpha 和 operation opacity
合成为有效 Alpha，再写入 Raster：

```ts
import { paintPixel, Raster, Rasterizers } from "@reverie/core";

const raster = new Raster();

Rasterizers.rasterizeCircle(
  { center: { x: 100.5, y: 100.5 }, radius: 20 },
  (hit) => {
    paintPixel(raster, hit, {
      color: { r: 255, g: 0, b: 0, a: 255 },
      opacity: 0.5,
    });
  },
);
```

## Circle Brush

`CircleBrush` 封装了圆形 Rasterizer 与 Paint Pipeline。`size` 表示 World
Space 中的直径，`stamp` 接受连续 World Position：

```ts
import { CircleBrush, Raster } from "@reverie/core";

const raster = new Raster();
const brush = new CircleBrush({
  size: 20,
  color: { r: 0, g: 255, b: 0, a: 255 },
  opacity: 0.8,
  spacing: 0.25,
});

brush.stamp(raster, { x: 50.5, y: 50.25 });
```

## Image Brush

`BrushImage` 是运行时中立、可重复使用的不可变 Alpha Mask；源图 RGB 会被忽略，
最终颜色始终来自 `ImageBrush.color`。`size` 表示图像最长边的 World Space 长度，
另一边按原始宽高比缩放；默认 anchor 为图像中心，也可传入 `[0, 1]` 范围内的
归一化坐标：

```ts
import { BrushImage, ImageBrush } from "@reverie/core";

const image = BrushImage.fromRGBA({
  width: 2,
  height: 1,
  pixels: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 96]),
});
const imageBrush = new ImageBrush({
  image,
  size: 40,
  color: { r: 84, g: 153, b: 255, a: 255 },
  opacity: 0.8,
  spacing: 0.2,
  anchor: { x: 0.5, y: 0.5 },
  rotation: -Math.PI / 2,
  dynamics: {
    rotation: { direction: {} },
  },
});

imageBrush.stamp(raster, { x: 50.5, y: 50.25 });
```

Stamp 会围绕 anchor 旋转，通过逆变换与双线性采样读取 Mask，并把图像边缘之外
视为透明。省略 `BrushImage.alpha` 时会创建全不透明 Mask，适合没有 Alpha 通道的
来源。图片文件的浏览器解码不属于 Core；`demo` 提供本地上传入口，将解码后的
RGBA 转为 `BrushImage`，但不会保存上传文件或画笔设置。

## Stroke

`Stroke` 保存连续 World Space 中的原始输入采样，并按照 `brush.size ×
brush.spacing` 沿折线路径均匀生成 `StampCommand`。命令由外部 Consumer
决定何时绘制：

```ts
import { Stroke } from "@reverie/core";

const stroke = new Stroke({ brush });

stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
stroke.addSample({ position: { x: 100, y: 50 }, timestamp: 16 });
stroke.end();

while (stroke.hasPendingStamps) {
  const command = stroke.nextStamp();

  if (command === undefined) break;
  stroke.brush.stamp(raster, command.position, command);
}
```

每个 `addSample` 还可以携带归一化压力与倾角。这些属性会在平滑、重采样与
Stamp Placement 中被一致地插值，并出现在每一条 `StampCommand` 上：

```ts
stroke.addSample({
  position: { x: 100, y: 50 },
  timestamp: 16,
  pressure: 0.4,
  tiltX: -20,
  tiltY: 10,
});
```

`pressure` 必须是 `[0, 1]` 内的有限数，`tiltX` / `tiltY` 必须是以度为单位、
位于 `[-90, 90]` 内的有限数。省略时分别取默认值 `1`、`0`、`0`，因此
`{ position, timestamp }` 形式的旧调用保持完全兼容。每条命令还包含相邻实际
Stamp 之间的速度，单位为 World Unit/ms；首条命令或非正时间差使用 `0`。
从第二个实际 Stamp 开始，命令还会包含由相邻 Stamp World Position 通过
`atan2(dy, dx)` 推导的弧度方向；首个 Stamp 没有真实方向，零距离也不会伪造
方向值。
浏览器输入由 `@reverie/web` 归一化：只有 `pointerType === "pen"` 的压力会被
采信，鼠标与触摸一律取 `1`。

## Brush Dynamics

`CircleBrush` 与 `ImageBrush` 都可以独立配置 Pressure → Size、Pressure →
Opacity、Velocity → Size、Velocity → Opacity、Direction → Rotation 和 Tilt →
Rotation。顶层 `rotation` 是静态弧度偏移；Direction 与 Tilt 配置项存在即启用，
最终角度按 Base + Direction + Tilt 相加。`min` 表示相对基础值的最小比例；
Pressure 和 Velocity 同时影响同一参数时，其归一化因子相乘：

```ts
const dynamicBrush = new CircleBrush({
  size: 20,
  color: { r: 0, g: 255, b: 0, a: 255 },
  opacity: 0.8,
  rotation: Math.PI / 8,
  dynamics: {
    size: {
      pressure: { min: 0.2 },
      velocity: { min: 0.5, maxVelocity: 1 },
    },
    opacity: {
      pressure: { min: 0.1 },
    },
    rotation: { direction: {}, tilt: {} },
  },
});
```

默认曲线为线性，也可提供实现 `DynamicsCurve.evaluate(input)` 的确定性自定义
曲线。输入和输出均为 `[0, 1]`。Tilt 旋转以弧度解析；圆形 Brush 的像素结果不受
旋转影响。未配置 dynamics 时仍使用原有固定参数快路径。

## Deterministic Brush Jitter

`CircleBrush` 与 `ImageBrush` 均支持可选的 `seed` 和 `jitter`。Jitter 在 Dynamics
之后逐 Stamp 应用，不修改基础参数、原始输入或 Stamp 间距：

```ts
import { CircleBrush, Stroke } from "@reverie/core";

const jitterBrush = new CircleBrush({
  size: 20,
  color: { r: 0, g: 255, b: 0, a: 255 },
  opacity: 0.8,
  seed: 123,
  jitter: {
    size: 0.2,
    opacity: 0.2,
    rotation: Math.PI / 12,
  },
});
const stroke = new Stroke({ brush: jitterBrush, strokeSequence: 7 });
const replaySeed = stroke.strokeSeed;
const replay = new Stroke({ brush: jitterBrush, strokeSeed: replaySeed });
```

`size` / `opacity` 是对称乘数的幅度：`0.2` 对应 `[0.8, 1.2]`。比例允许大于
`1`，最终尺寸截到非负数，透明度截到 `[0, 1]`；零尺寸或零透明度不绘制。
`rotation` 是弧度表示的最大加性偏移；圆形 Brush 的旋转没有可见效果。三个
幅度都必须是非负有限数，省略或 `0` 表示关闭；有限配置的计算若溢出则抛错。

Seed、笔画序号、Stamp 编号和 channel ID 均使用 `[0, 4294967295]` 内的整数；
负数、小数、越界和非有限值会被拒绝。所有种子混合、乘法、移位及哈希步骤
显式保持 uint32 语义，乘法采用 `Math.imul`，中间结果按 `2^32` 取模。
Brush seed 默认 `0`；Core 不使用全局计数器，独立调用方负责递增并记录
`strokeSequence`（默认 `0`）。显式 `strokeSeed` 是最终种子，会覆盖派生过程，
包括显式值 `0`。恢复最终种子时，不使用也不校验 Brush seed 和笔画序号。

Stroke 为每条实际生成的命令附带最终 `strokeSeed` 和从 `0` 开始的 `stampIndex`。
编号不随队列消费或调度分帧改变；超过 uint32 编号空间会抛出
`ErrorCodes.STROKE.STAMP_INDEX_EXHAUSTED`，而非重复编号。
`@reverie/web` 的 `CanvasDrawingSession` 自动递增笔画序号，并在 uint32 上限后
回到 `0`；保存时可读取 `session.nextStrokeSequence`，恢复时传入
`ReverieCanvasConfig` 或 `CanvasDrawingSessionConfig` 的 `strokeSequence`。
固定 seed 空间在完整循环后会重用序列。

```ts
import { ReverieCanvas } from "@reverie/web";

const savedSequence = reverie.session.nextStrokeSequence;
reverie.dispose();
const restoredCanvas = new ReverieCanvas({
  canvas,
  brush: jitterBrush,
  strokeSequence: savedSequence,
});
```

直接 `brush.stamp(raster, position)` 或旧命令缺少随机上下文时，使用 Brush seed
和编号 `0`，所以不会因调用次数产生隐式变化。也可在命令中独立提供
`strokeSeed` 与 `stampIndex`。Jitter 关闭时，旧命令和绘制行为保持兼容。
`brush.resolveParameters()` 同样允许省略输入，使用中性 Dynamics 默认值和
上述固定随机上下文；`stamp` 复用这个参数解析入口。

随机基础设施可通过 `deriveStrokeSeed(brushSeed, strokeSequence)`、
`sampleStampRandom(strokeSeed, stampIndex, channel)` 和冻结的
`STAMP_RANDOM_CHANNELS` 使用。固定 channel ID 为 size `1`、rotation `2`、
opacity `3`；新功能应使用新的稳定 ID。Sample 范围为 `[0, 1)`，
`sample * 2 - 1` 得到 `[-1, 1)`。按 seed、编号、channel 独立寻址，无可变 RNG
流，也不依赖 `Math.random()`、Web API、渲染时机或 frame budget。
Channel 会先进行 uint32 哈希再与 seed 混合，使两个参数具有不同角色。

## Canvas Renderer

`CanvasRenderer` 将稀疏 Raster 按照 Camera 当前视图绘制到 Canvas backing
buffer。修改 Camera 或 Raster 后需要显式调用 `render()`：

```ts
import { Camera, Raster } from "@reverie/core";
import { CanvasRenderer } from "@reverie/renderer";

const raster = new Raster();
const camera = new Camera({ zoom: 8 });
const renderer = new CanvasRenderer({ canvas, raster, camera });

renderer.resize(800, 600);
renderer.render();
```

## Drawing Scheduler

`@reverie/web` 的 `DrawingScheduler` 将 `StampCommand` 包装为可执行的
`DrawingCommand`，并通过可注入的 `FrameDriver` 在软帧预算内按 FIFO 顺序
分批绘制：

```ts
import { DrawingScheduler } from "@reverie/web";

const scheduler = new DrawingScheduler({
  frameBudget: 4,
  onRender: () => renderer.render(),
  onError: (error) => reportDrawingError(error),
});

while (stroke.hasPendingStamps) {
  const stamp = stroke.nextStamp();

  if (stamp === undefined) break;
  scheduler.enqueue({ stamp, brush: stroke.brush, raster });
}
```

`demo` 提供了可直接按下并拖动绘画的连续 Stroke 画布，并可调整颜色、
Brush Size、Spacing、Opacity、Pan 和 Zoom，也可临时上传图片切换为 Image
Brush；上传的非对称 Brush Tip 默认沿实际 Stamp 路径旋转。绘制命令由主线程上的
`DrawingScheduler` 按帧消费。

## Export Renderer

`@reverie/exporter` 的 `ExportRenderer` 将 World Pixel Region 导出为稠密的
RGBA8 buffer。导出区域使用半开区间 `[x, x + width) × [y, y + height)`，未
分配的 Tile 在输出中保持透明黑，且 Raster 本身不会被修改：

```ts
import { ExportRenderer } from "@reverie/exporter";

const exporter = new ExportRenderer({ raster });

const image = exporter.render({
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
});

// image.width === 1920
// image.height === 1080
// image.pixels.length === 1920 * 1080 * 4
```

`render()` 是同步 API，每次调用都返回一个全新的 buffer；buffer 使用 straight
alpha，不进行 premultiply、缩放或图层合成。`render()` 只输出原始 RGBA 数据，
编码为实际图片文件由 `Image Encoders` 负责。

`demo` 中的 “Export to console” 按钮会把当前画布导出为 1920 × 1080 的 RGBA
buffer，并把完整的 `Uint8ClampedArray` 输出到浏览器控制台。

## Image Encoders

`@reverie/exporter` 的 `PNGEncoder`、`JPEGEncoder` 与 `WebPEncoder` 将
`ExportResult` 编码为完整的图片文件。Encoder 只读取 bitmap，不接触 Raster、
World 或 Camera，输出统一为运行时中立的 `Uint8Array`：

```ts
import { JPEGEncoder, PNGEncoder, WebPEncoder } from "@reverie/exporter";

const png = await new PNGEncoder().encode(image, { compressionLevel: 6 });
const jpeg = await new JPEGEncoder().encode(image, { quality: 0.92 });
const webp = await new WebPEncoder().encode(image, { lossless: true });

// png.mimeType === "image/png";   png.extension === "png"
// jpeg.mimeType === "image/jpeg"; jpeg.extension === "jpg"
// webp.mimeType === "image/webp"; webp.extension === "webp"
```

PNG 始终无损，包括完全透明像素中保留的颜色通道。JPEG 没有 Alpha 通道，因此会
先把 RGBA 合成到不透明背景上（默认白色，可通过 `background` 指定）。WebP 默认
无损编码并精确保留 Alpha，只有显式传入 `lossless: false` 时才走有损路径；有损
bitstream 无法携带 Alpha，会退化为颜色通道本身。

所有 Encoder 都是无状态的：既不修改传入的 bitmap，也不在实例上保留上一次的
输入或结果，因此同一个实例可以并发编码。输入会在编码前校验，非法尺寸、错误的
buffer 长度或越界的 quality / compressionLevel 都会抛出带稳定 code 的
`ExporterTypeError` 或 `ExporterRangeError`。

## Web Download

`@reverie/web` 的 `downloadEncodedImage` 把已编码的 `EncodedImage` 交付给浏览器下载：字节被包装为 `Blob`（MIME 取自 `image.mimeType`），通过临时 Object URL 与临时 `<a>` 触发下载，随后撤销 Object URL 并移除临时节点。该 Helper 是浏览器专用逻辑，只负责交付字节，不读取 Raster、不渲染、不编码：

```ts
import { downloadEncodedImage } from "@reverie/web";

downloadEncodedImage(image, { filename: "artwork" });
```

省略 `filename` 时使用 `drawing.<extension>`；`filename` 缺少扩展名时会补上编码结果的扩展名，已有扩展名则原样保留，因此不会出现 `artwork.png.png`。

`ReverieCanvas` 在同一个 Helper 之上提供高层入口。它以 `world.bounds` 作为默认导出区域，固定尺寸画布一次调用即可导出整幅画面；无限 World 没有自然的完整尺寸，必须显式传入 `region`：

```ts
await reverie.download({ format: "png", filename: "drawing.png" });

await reverie.download({
  format: "jpeg",
  filename: "artwork.jpg",
  quality: 0.9,
});

await reverie.download({
  format: "webp",
  filename: "artwork.webp",
  lossless: false,
});

await reverie.download({
  format: "png",
  region: { x: -1024, y: -1024, width: 2048, height: 2048 },
});
```

`download()` 只导出当前 `activeLayer`，不做多图层合成；导出过程只读取 Raster，不会修改像素、Camera、Brush 或 Scheduler。PNG 支持 `compressionLevel`（`0..9`，默认 `6`）。JPEG 需要全局 `Buffer`，`download()` 会自动安装对应的 shim，因此浏览器环境无需手动调用；只有直接使用 `JPEGEncoder` 时才需要先调用一次 `JPEGEncoder.installJpegJsBufferShim()`。

`demo` 中的 “Export PNG / JPEG / WebP” 按钮通过 `ReverieCanvas.download()` 直接下载导出结果。

## 开始使用

```bash
pnpm install
pnpm dev
```

`dev` 和测试命令会保留使用 `// #if DEBUG` 标记的调试代码；生产构建和
带有 `no-debug` 后缀的命令会在编译时移除这些代码。

常用命令：

```bash
pnpm build
pnpm dev
pnpm dev:no-debug
pnpm test
pnpm test:no-debug
pnpm test:watch
pnpm test:verbose
pnpm typecheck
```
