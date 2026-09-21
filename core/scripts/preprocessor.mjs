/**
 * Helpers for running the raw `unplugin-preprocessor-directives` hooks.
 *
 * Unplugin only normalizes plugin hooks inside its bundler adapters, so
 * `unplugin.raw()` hands back the factory's own, un-normalized hook objects.
 * These helpers resolve and validate that shape explicitly and turn every
 * "the preprocessor did not actually run" outcome into a failure, because
 * staging original sources instead of preprocessed ones would ship
 * `// #if DEBUG` code in a no-debug build.
 */

/**
 * Transforms one file and returns its rewritten source, or `undefined` when the
 * file contains no directives.
 *
 * @typedef {(code: string, id: string) => unknown} TransformHook
 */

/**
 * Validated hooks that can be called for every staged source file.
 *
 * @typedef {object} Preprocessor
 * @property {(id: string) => boolean} shouldTransform - Reports whether a file
 *   must be preprocessed.
 * @property {TransformHook} transform - Rewrites directives in a file.
 */

/** Unguarded statement that must survive preprocessing in every mode. */
const PROBE_STATEMENT_ALWAYS = "probeAlwaysStaged = 1";

/** Statement that must survive only while debug code is enabled. */
const PROBE_STATEMENT_DEBUG = "probeDebugOnly = 2";

/** Statement guarded by a symbol the preprocessor cannot resolve. */
const PROBE_STATEMENT_UNRESOLVED = "probeUnknownSymbol = 3";

/** Symbol that deliberately resolves to nothing, so its guard is always false. */
const PROBE_UNRESOLVED_SYMBOL = "PREPROCESSOR_PROBE_UNRESOLVED";

/**
 * Synthetic source used by {@link verifyPreprocessor}. It exercises the three
 * outcomes that matter: unguarded code is preserved, `DEBUG` guarded code is
 * kept only when debug code is enabled, and a guard on an unresolvable symbol
 * is always removed.
 */
const PROBE_SOURCE = [
  `const ${PROBE_STATEMENT_ALWAYS};`,
  "// #if DEBUG",
  `const ${PROBE_STATEMENT_DEBUG};`,
  "// #endif",
  `// #if ${PROBE_UNRESOLVED_SYMBOL}`,
  `const ${PROBE_STATEMENT_UNRESOLVED};`,
  "// #endif",
].join("\n");

/**
 * Resolves the preprocessor hooks exposed by the raw plugin instance.
 *
 * Both the plain function form and unplugin's object form (`{ handler }`) are
 * accepted. Anything else fails here, at startup, instead of quietly leaving
 * sources unpreprocessed.
 *
 * @param {{
 *   transform?: TransformHook | { handler?: TransformHook },
 *   transformInclude?: (id: string) => boolean | null | undefined,
 * }} plugin - Raw plugin returned by `unplugin.raw()`.
 * @returns {Preprocessor} Validated hooks, bound to the plugin instance.
 * @throws {Error} If either hook is missing or is not callable.
 */
export function resolvePreprocessor(plugin) {
  const transformHook = plugin?.transform;
  const transform =
    typeof transformHook === "function"
      ? transformHook
      : transformHook?.handler;
  const transformInclude = plugin?.transformInclude;

  if (typeof transform !== "function") {
    throw new Error(
      "The preprocessor plugin does not expose a callable transform hook. " +
        "Update core/scripts/build.mjs to match the plugin's current hook shape.",
    );
  }

  if (typeof transformInclude !== "function") {
    throw new Error(
      "The preprocessor plugin does not expose a transformInclude hook, so the " +
        "build cannot tell which files require preprocessing. " +
        "Update core/scripts/build.mjs to match the plugin's current hook shape.",
    );
  }

  return {
    shouldTransform: (id) => Boolean(transformInclude.call(plugin, id)),
    transform: (code, id) => transform.call(plugin, code, id),
  };
}

/**
 * Extracts preprocessed code from the value returned by the transform hook.
 *
 * The hook returns `undefined` when a file contains no preprocessor directives,
 * which is the only result that legitimately means "stage the original source".
 * Any other unexpected value fails the build: falling back to the original
 * source would leave `// #if DEBUG` code in a no-debug build while the build
 * still reports success.
 *
 * @param {unknown} result - Value returned by the transform hook.
 * @param {string} source - Original source to stage when no directives apply.
 * @param {string} filePath - File being staged, used in error messages.
 * @returns {string} Source to hand to the TypeScript compiler.
 * @throws {Error} If the hook returned a value that is not usable code.
 */
export function getTransformedCode(result, source, filePath) {
  if (result === undefined || result === null) {
    return source;
  }

  if (typeof result === "string") {
    return result;
  }

  if (
    typeof result === "object" &&
    "code" in result &&
    typeof result.code === "string"
  ) {
    return result.code;
  }

  const description =
    typeof result === "object" && "code" in result
      ? 'an object whose "code" property is not a string'
      : `a value of type ${typeof result}`;

  throw new Error(
    `The preprocessor returned ${description} for ${filePath}. ` +
      "Expected rewritten source or undefined.",
  );
}

/**
 * Verifies the preprocessing pipeline against a synthetic source.
 *
 * A hook that quietly does nothing would still let the build succeed, so the
 * probe proves the pipeline works before any real source is staged: unguarded
 * code survives, `DEBUG` guarded code is kept exactly when debug code is
 * enabled, and a guard on an unresolvable symbol is removed.
 *
 * @param {boolean} isDebug - Whether this build enables debug code.
 * @param {Preprocessor} preprocessor - Hooks returned by
 *   {@link resolvePreprocessor}.
 * @param {string} probePath - Path reported for the synthetic source. It must
 *   look like a preprocessable source file but is never written to disk.
 * @returns {Promise<void>} Resolves when the pipeline behaves correctly.
 * @throws {Error} If the probe is filtered out or transformed incorrectly.
 */
export async function verifyPreprocessor(isDebug, preprocessor, probePath) {
  if (!preprocessor.shouldTransform(probePath)) {
    throw new Error(
      `The preprocessor does not accept ${probePath}, so no source would be preprocessed.`,
    );
  }

  const result = await preprocessor.transform(PROBE_SOURCE, probePath);

  if (typeof result !== "string") {
    throw new Error(
      `The preprocessor returned ${typeof result} instead of rewritten source for ${probePath}.`,
    );
  }

  if (!result.includes(PROBE_STATEMENT_ALWAYS)) {
    throw new Error(
      `The preprocessor dropped unguarded code from ${probePath}.`,
    );
  }

  if (result.includes(PROBE_STATEMENT_UNRESOLVED)) {
    throw new Error(
      `The preprocessor kept code guarded by the unresolvable symbol ` +
        `${PROBE_UNRESOLVED_SYMBOL}, so directives are not being evaluated.`,
    );
  }

  if (result.includes(PROBE_STATEMENT_DEBUG) !== isDebug) {
    throw new Error(
      `The preprocessor did not ${isDebug ? "keep" : "remove"} "#if DEBUG" code ` +
        `in ${isDebug ? "debug" : "no-debug"} mode.`,
    );
  }
}
