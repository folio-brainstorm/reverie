import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

/**
 * Starts or collects a Chrome trace around Pan, outside measured render calls.
 * Durations from parallel threads are reported separately, never added to frame time.
 * @returns Completion after the requested trace operation and artifact write.
 */
export default async function capturePanTrace(client, output, stage) {
  if (stage === "start") {
    await client.send("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,gpu,viz",
      transferMode: "ReturnAsStream",
    });
    return;
  }
  const finished = new Promise((resolve) =>
    client.once("Tracing.tracingComplete", resolve),
  );
  await client.send("Tracing.end");
  const { stream } = await finished;
  let content = "";
  for (;;) {
    const chunk = await client.send("IO.read", { handle: stream });
    content += chunk.data;
    if (chunk.eof) break;
  }
  await client.send("IO.close", { handle: stream });
  const trace = JSON.parse(content);
  const threadNames = new Map();
  for (const event of trace.traceEvents) {
    if (event.name === "thread_name")
      threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
  }
  const timings = new Map();
  for (const event of trace.traceEvents) {
    if (event.ph !== "X" || typeof event.dur !== "number") continue;
    const thread =
      threadNames.get(`${event.pid}:${event.tid}`) ??
      `${event.pid}:${event.tid}`;
    const key = `${thread}: ${event.name}`;
    const timing = timings.get(key) ?? {
      thread,
      name: event.name,
      count: 0,
      durationMs: 0,
      maxMs: 0,
    };
    timing.count += 1;
    timing.durationMs += event.dur / 1000;
    timing.maxMs = Math.max(timing.maxMs, event.dur / 1000);
    timings.set(key, timing);
  }
  await writeFile(`${output}.json.gz`, gzipSync(content));
  await writeFile(
    `${output}-summary.json`,
    JSON.stringify(
      [...timings.values()].sort((a, b) => b.durationMs - a.durationMs),
      null,
      2,
    ),
  );
}
