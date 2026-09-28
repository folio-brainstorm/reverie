import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROOT_PACKAGE_URL = new URL("../../package.json", import.meta.url);

/** Reads a root workflow script without assuming the manifest's JSON shape. */
function readRootScript(scriptName: string): string {
  const manifest: unknown = JSON.parse(readFileSync(ROOT_PACKAGE_URL, "utf8"));

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("scripts" in manifest) ||
    typeof manifest.scripts !== "object" ||
    manifest.scripts === null
  ) {
    throw new Error("The root package must define workflow scripts.");
  }

  const script: unknown = Reflect.get(manifest.scripts, scriptName);

  if (typeof script !== "string") {
    throw new Error(`Missing root workflow script: ${scriptName}`);
  }

  return script;
}

describe("workspace build prerequisites", () => {
  it.each([
    "build",
    "dev",
    "dev:no-debug",
    "test",
    "test:no-debug",
    "test:watch",
    "test:verbose",
  ])("%s builds exporter before its web consumer", (scriptName) => {
    const commands = readRootScript(scriptName).split(" && ");
    const exporterBuildIndex = commands.indexOf(
      "pnpm --filter @reveriejs/exporter build",
    );
    const webBuildIndex = commands.indexOf("pnpm --filter @reveriejs/web build");

    expect(exporterBuildIndex).toBeGreaterThanOrEqual(0);
    expect(webBuildIndex).toBeGreaterThan(exporterBuildIndex);
  });
});
