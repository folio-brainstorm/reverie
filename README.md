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
  stroke.brush.stamp(raster, command.position);
}
```

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
Brush Size、Spacing、Opacity、Pan 和 Zoom。绘制命令由主线程上的
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

`demo` 中的 “Export to console” 按钮会把当前画布导出为 16 × 16 的 RGBA
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
