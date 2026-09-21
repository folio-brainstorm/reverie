import { fileURLToPath } from "node:url";

import { unplugin } from "unplugin-preprocessor-directives";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getTransformedCode,
  resolvePreprocessor,
  verifyPreprocessor,
} from "../../core/scripts/preprocessor.mjs";

const PROBE_PATH = fileURLToPath(
  new URL("../../core/src/PreprocessorProbe.ts", import.meta.url),
);

/**
 * Creates the preprocessor hooks exactly like the core build script does.
 *
 * The filter is a regular expression on purpose: the plugin resolves string
 * patterns against the current working directory, so a glob would reject source
 * files that live outside this test package.
 */
function createPreprocessor() {
  const plugin = unplugin.raw({ include: /\.ts$/ }, { framework: "rollup" });
  return resolvePreprocessor(Array.isArray(plugin) ? plugin[0] : plugin);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePreprocessor", () => {
  it("rejects a plugin without a callable transform hook", () => {
    expect(() => resolvePreprocessor({ transformInclude: () => true })).toThrow(
      /transform hook/,
    );
  });

  it("rejects a plugin without a callable transformInclude hook", () => {
    expect(() => resolvePreprocessor({ transform: (code) => code })).toThrow(
      /transformInclude/,
    );
  });

  it("accepts object-form and function-form transform hooks", () => {
    const objectForm = resolvePreprocessor({
      transform: { handler: (code) => `handled:${code}` },
      transformInclude: (id) => id.endsWith(".ts"),
    });

    expect(objectForm.shouldTransform("source.ts")).toBe(true);
    expect(objectForm.shouldTransform("source.js")).toBe(false);
    expect(objectForm.transform("original", "source.ts")).toBe(
      "handled:original",
    );

    const functionForm = resolvePreprocessor({
      transform: (code) => `handled:${code}`,
      transformInclude: () => true,
    });

    expect(functionForm.transform("original", "source.ts")).toBe(
      "handled:original",
    );
  });
});

describe("getTransformedCode", () => {
  it.each([undefined, null])(
    "stages the original source when the hook returns %s",
    (result) => {
      expect(getTransformedCode(result, "original", "source.ts")).toBe(
        "original",
      );
    },
  );

  it("returns returned code for string and object hook results", () => {
    expect(getTransformedCode("rewritten", "original", "source.ts")).toBe(
      "rewritten",
    );
    expect(
      getTransformedCode({ code: "rewritten" }, "original", "source.ts"),
    ).toBe("rewritten");
  });

  it("rejects unsupported hook results instead of staging the original source", () => {
    expect(() =>
      getTransformedCode({ map: "unexpected" }, "original", "source.ts"),
    ).toThrow(/source\.ts/);
    expect(() => getTransformedCode(42, "original", "source.ts")).toThrow(
      /source\.ts/,
    );
  });
});

describe("verifyPreprocessor", () => {
  it.each([false, true])(
    "accepts the real preprocessor when DEBUG=%s",
    async (isDebug) => {
      vi.stubEnv("DEBUG", String(isDebug));
      const preprocessor = createPreprocessor();

      await expect(
        verifyPreprocessor(isDebug, preprocessor, PROBE_PATH),
      ).resolves.toBeUndefined();
    },
  );

  it.each([false, true])(
    "rejects a preprocessor that leaves guarded code untouched when DEBUG=%s",
    async (isDebug) => {
      const preprocessor = {
        shouldTransform: () => true,
        transform: (code: string): string => code,
      };

      await expect(
        verifyPreprocessor(isDebug, preprocessor, PROBE_PATH),
      ).rejects.toThrow(/are not being evaluated/);
    },
  );

  it("rejects a preprocessor that does not accept the probe path", async () => {
    const preprocessor = {
      shouldTransform: () => false,
      transform: (code: string): string => code,
    };

    await expect(
      verifyPreprocessor(false, preprocessor, PROBE_PATH),
    ).rejects.toThrow(/does not accept/);
  });

  it.each([
    {
      environment: "true",
      isDebug: false,
      expectation: 'did not remove "#if DEBUG" code in no-debug mode',
    },
    {
      environment: "false",
      isDebug: true,
      expectation: 'did not keep "#if DEBUG" code in debug mode',
    },
  ])(
    "rejects a preprocessor that disagrees with the selected mode when DEBUG=$environment",
    async ({ environment, isDebug, expectation }) => {
      vi.stubEnv("DEBUG", environment);
      const preprocessor = createPreprocessor();

      await expect(
        verifyPreprocessor(isDebug, preprocessor, PROBE_PATH),
      ).rejects.toThrow(expectation);
    },
  );
});
