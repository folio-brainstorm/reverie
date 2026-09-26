import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import capturePanTrace from "./CapturePanTrace.mjs";

const requireRenderer = createRequire(
  new URL("../../renderers/canvas-renderer/package.json", import.meta.url),
);
const { chromium } = requireRenderer("playwright");
const outputDirectory = new URL(process.env["PAN_PROFILE_RESULTS"] ?? "./results/", import.meta.url);
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
  optimizeDeps: {
    exclude: [
      "@reverie/core",
      "@reverie/core/renderer",
      "@reverie/canvas-renderer",
      "@reverie/web",
      "@reverie/exporter",
    ],
  },
  plugins: [
    {
      name: "isolated-pan-measurements",
      configureServer(runtime) {
        runtime.middlewares.use("/profiling/blank", (_request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.end(
            "<!doctype html><html><head><title>Pan profile</title></head><body></body></html>",
          );
        });
      },
      transform(code, id) {
        if (
          !id
            .replaceAll("\\", "/")
            .endsWith(
              "/core/dist/src/core/rendering/region/DownsampleRgbaTile.js",
            )
        )
          return;
        const marker = "export function downsampleRgbaTile(";
        if (!code.includes(marker))
          throw new Error(
            "Downsample instrumentation no longer matches the built module.",
          );
        return (
          code.replace(marker, "function measuredDownsampleRgbaTile(") +
          `
export function downsampleRgbaTile(source, sourceSize, outputSize) {
  if (!globalThis.__reveriePanLod) return measuredDownsampleRgbaTile(source, sourceSize, outputSize);
  const start = performance.now();
  try { return measuredDownsampleRgbaTile(source, sourceSize, outputSize); }
  finally { globalThis.__reveriePanLod?.(performance.now() - start, sourceSize, outputSize); }
}`
        );
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 750 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "info") console.info(message.text());
  });
  page.on("pageerror", (error) => console.error(error));
  await page.goto("http://127.0.0.1:5187/profiling/blank");
  const instrument = process.env["PAN_PROFILE_INSTRUMENT"] !== "false";
  const scenarioIndex = Number(process.env["PAN_PROFILE_CASE"] ?? -1);
  if (
    !Number.isInteger(scenarioIndex) ||
    scenarioIndex < -1 ||
    scenarioIndex > 5
  )
    throw new Error("PAN_PROFILE_CASE must be -1 or an integer from 0 to 5.");
  await mkdir(outputDirectory, { recursive: true });
  if (process.env["PAN_PROFILE_TRACE"] === "true") {
    if (scenarioIndex < 0)
      throw new Error("Tracing requires a single PAN_PROFILE_CASE.");
    const client = await page.context().newCDPSession(page);
    await page.exposeFunction("__reveriePanTrace", (stage) =>
      capturePanTrace(
        client,
        fileURLToPath(new URL(`trace-case${scenarioIndex}`, outputDirectory)),
        stage,
      ),
    );
  }
  const results = await page.evaluate(
    async ({ instrument, scenarioIndex }) => {
      const module = await import("/profiling/PanProfile.ts");
      return module.default(instrument, scenarioIndex);
    },
    { instrument, scenarioIndex },
  );
  const filename = `pan-profile${instrument ? "" : "-baseline"}${scenarioIndex < 0 ? "" : `-case${scenarioIndex}`}.json`;
  await writeFile(
    new URL(filename, outputDirectory),
    JSON.stringify(
      {
        browser: browser.version(),
        node: process.version,
        capturedAt: new Date().toISOString(),
        instrument,
        ...results,
      },
      null,
      2,
    ),
  );
  console.info(`Saved ${fileURLToPath(new URL(filename, outputDirectory))}`);
} finally {
  await browser?.close();
  await server.close();
}
