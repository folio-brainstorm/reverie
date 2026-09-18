import { readFileSync } from "node:fs";

import { unplugin } from "unplugin-preprocessor-directives";
import { afterEach, describe, expect, it, vi } from "vitest";

const WORLD_SOURCE_URL = new URL(
  "../../core/src/core/world/World.ts",
  import.meta.url,
);
const DEFAULT_CONFIG_URL = new URL(
  "../../core/src/config/DefaultWorldConfig.ts",
  import.meta.url,
);
const DIAGNOSTICS_URL = new URL(
  "../../core/src/utils/diagnostic/Diagnostics.ts",
  import.meta.url,
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("World reporter conditional compilation", () => {
  it.each([false, true])(
    "produces valid reporter code with DEBUG=%s",
    async (isDebug) => {
      vi.stubEnv("DEBUG", String(isDebug));
      const source = readFileSync(WORLD_SOURCE_URL, "utf8");
      const rawPlugin = unplugin.raw({}, { framework: "rollup" });
      const plugin = Array.isArray(rawPlugin) ? rawPlugin[0] : rawPlugin;
      if (plugin === undefined || typeof plugin.transform !== "function") {
        throw new Error(
          "Expected the core preprocessor's raw transform function.",
        );
      }
      const unsupportedHook = (): never => {
        throw new Error(
          "World preprocessing should not invoke a bundler hook.",
        );
      };
      const pluginContext = {
        addWatchFile: unsupportedHook,
        emitFile: unsupportedHook,
        getWatchFiles: unsupportedHook,
        parse: unsupportedHook,
        error: unsupportedHook,
        warn: unsupportedHook,
      };
      const result = await plugin.transform.call(
        pluginContext,
        source,
        WORLD_SOURCE_URL.pathname,
      );
      const transformed = typeof result === "string" ? result : result?.code;
      expect(transformed).toBeDefined();
      const reporterCode = transformed?.match(
        /const reporter =[\s\S]*?(?=const bounds =)/,
      )?.[0];
      if (reporterCode === undefined) {
        throw new Error("Expected the preprocessed World reporter expression.");
      }
      // Compile only the JavaScript expression so both branch syntax and actual
      // fallback behavior are checked without creating build artifacts.
      const resolve = new Function(
        "config",
        "defaultWorldConfig",
        "consoleDiagnosticReporter",
        `${reporterCode}\nreturn reporter;`,
      );
      const diagnostic = () => undefined;
      expect(resolve({}, {}, diagnostic)).toBe(
        isDebug ? diagnostic : undefined,
      );
      expect(
        resolve({ reporter: "explicit" }, { reporter: "default" }, diagnostic),
      ).toBe("explicit");
      expect(resolve({}, { reporter: "default" }, diagnostic)).toBe("default");
      const configResult = await plugin.transform.call(
        pluginContext,
        readFileSync(DEFAULT_CONFIG_URL, "utf8"),
        DEFAULT_CONFIG_URL.pathname,
      );
      const configCode =
        typeof configResult === "string" ? configResult : configResult?.code;
      const initializer = configCode?.match(
        /export const defaultWorldConfig: WorldConfig = ([\s\S]*?);/,
      )?.[1];
      if (initializer === undefined) {
        throw new Error("Expected preprocessed World defaults.");
      }
      const defaults = new Function(
        "DEFAULT_WORLD_TILE_SIZE",
        "consoleDiagnosticReporter",
        `return (${initializer});`,
      )(256, diagnostic);
      expect(resolve({}, defaults, diagnostic)).toBe(
        isDebug ? diagnostic : undefined,
      );
      const diagnosticsResult = await plugin.transform.call(
        pluginContext,
        readFileSync(DIAGNOSTICS_URL, "utf8"),
        DIAGNOSTICS_URL.pathname,
      );
      const diagnosticsCode =
        typeof diagnosticsResult === "string"
          ? diagnosticsResult
          : diagnosticsResult?.code;
      expect(
        diagnosticsCode?.includes("export const consoleDiagnosticReporter"),
      ).toBe(isDebug);
    },
  );
});
