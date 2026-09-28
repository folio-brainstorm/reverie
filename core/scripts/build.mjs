import { spawn } from "node:child_process";
import { watch as watchFileSystem } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { unplugin } from "unplugin-preprocessor-directives";

import {
  getTransformedCode,
  resolvePreprocessor,
  verifyPreprocessor,
} from "./preprocessor.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const SOURCE_DIRECTORY = path.join(CORE_DIRECTORY, "src");
const CACHE_DIRECTORY = path.join(CORE_DIRECTORY, ".cache", "preprocessor");
const PREPROCESSOR_PROBE_FILE = path.join(
  SOURCE_DIRECTORY,
  "PreprocessorProbe.ts",
);
const TYPESCRIPT_PACKAGE_DIRECTORY = path.dirname(
  fileURLToPath(import.meta.resolve("typescript/package.json")),
);
const TYPESCRIPT_COMPILER = path.join(
  TYPESCRIPT_PACKAGE_DIRECTORY,
  "bin",
  "tsc",
);

/**
 * Parses and validates the conditional-compilation options passed by package
 * scripts.
 *
 * @returns {{ isDebug: boolean, isWatch: boolean }} The selected build mode.
 */
function parseArguments() {
  const supportedArguments = new Set([
    "--debug=true",
    "--debug=false",
    "--watch",
  ]);
  const unknownArgument = process.argv
    .slice(2)
    .find((argument) => !supportedArguments.has(argument));

  if (unknownArgument !== undefined) {
    throw new Error(`Unsupported build argument: ${unknownArgument}`);
  }

  const debugArguments = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith("--debug="));

  if (debugArguments.length !== 1) {
    throw new Error("Pass exactly one of --debug=true or --debug=false.");
  }

  return {
    isDebug: debugArguments[0] === "--debug=true",
    isWatch: process.argv.includes("--watch"),
  };
}

/**
 * Finds every TypeScript source file below a directory.
 *
 * @param {string} directory - Absolute directory to scan.
 * @returns {Promise<string[]>} Absolute paths sorted for deterministic builds.
 */
async function findTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findTypeScriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/**
 * Writes a file only when its contents changed, preventing unnecessary watch
 * rebuilds.
 *
 * @param {string} filePath - Destination path.
 * @param {string} contents - Desired UTF-8 contents.
 * @returns {Promise<void>}
 */
async function writeIfChanged(filePath, contents) {
  let currentContents;

  try {
    currentContents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (currentContents === contents) {
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryFile, contents, "utf8");
  await rename(temporaryFile, filePath);
}

/**
 * Mirrors current core sources into the compiler staging directory after
 * applying preprocessor directives.
 *
 * @param {string} stagingDirectory - Mode-specific staging directory.
 * @param {{ shouldTransform: (id: string) => boolean, transform: (code: string, id: string) => unknown }} preprocessor
 *   Hooks returned by {@link resolvePreprocessor}.
 * @returns {Promise<void>}
 */
async function synchronizeSources(stagingDirectory, preprocessor) {
  const sourceFiles = [
    path.join(CORE_DIRECTORY, "index.ts"),
    ...(await findTypeScriptFiles(SOURCE_DIRECTORY)),
  ];
  const expectedStagedFiles = new Set();

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(CORE_DIRECTORY, sourceFile);
    const stagedFile = path.join(stagingDirectory, relativePath);
    const source = await readFile(sourceFile, "utf8");
    const result = preprocessor.shouldTransform(sourceFile)
      ? await preprocessor.transform(source, sourceFile)
      : undefined;

    expectedStagedFiles.add(path.normalize(stagedFile));
    await writeIfChanged(
      stagedFile,
      getTransformedCode(result, source, sourceFile),
    );
  }

  let stagedFiles = [];

  try {
    stagedFiles = await findTypeScriptFiles(stagingDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  for (const stagedFile of stagedFiles) {
    if (!expectedStagedFiles.has(path.normalize(stagedFile))) {
      await rm(stagedFile);
    }
  }
}

/**
 * Creates the temporary TypeScript project that preserves the package's
 * existing output layout.
 *
 * @param {string} stagingDirectory - Mode-specific staging directory.
 * @returns {Promise<void>}
 */
async function writeStagingConfig(stagingDirectory) {
  const config = {
    extends: path
      .relative(stagingDirectory, path.join(CORE_DIRECTORY, "tsconfig.json"))
      .replaceAll("\\", "/"),
    compilerOptions: {
      outDir: path
        .relative(stagingDirectory, path.join(CORE_DIRECTORY, "dist"))
        .replaceAll("\\", "/"),
      rootDir: ".",
    },
    include: ["index.ts", "src/**/*.ts"],
    exclude: ["node_modules"],
  };

  await writeIfChanged(
    path.join(stagingDirectory, "tsconfig.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

/**
 * Starts the repository-pinned TypeScript compiler for the staged project.
 *
 * @param {string} stagingDirectory - Mode-specific staging directory.
 * @param {boolean} isWatch - Whether to keep TypeScript watching for changes.
 * @returns {import("node:child_process").ChildProcess} Compiler process.
 */
function startCompiler(stagingDirectory, isWatch) {
  const arguments_ = [
    TYPESCRIPT_COMPILER,
    "-p",
    path.join(stagingDirectory, "tsconfig.json"),
  ];

  if (isWatch) {
    arguments_.push("--watch", "--preserveWatchOutput");
  }

  const compiler = spawn(process.execPath, arguments_, {
    cwd: CORE_DIRECTORY,
    stdio: "inherit",
  });

  compiler.on("error", (error) => {
    console.error("Failed to start the TypeScript compiler.", error);
    process.exitCode = 1;
  });

  return compiler;
}

/**
 * Watches original sources and serializes staging updates so TypeScript never
 * receives overlapping writes.
 *
 * @param {() => Promise<void>} synchronize - Staging synchronization callback.
 * @param {(error: unknown) => void} onError - Fatal synchronization handler.
 * @returns {import("node:fs").FSWatcher[]} Active source watchers.
 */
function watchSources(synchronize, onError) {
  let timer;
  let pendingSynchronization = Promise.resolve();
  const scheduleSynchronization = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pendingSynchronization = pendingSynchronization
        .then(synchronize)
        .catch(onError);
    }, 50);
  };

  return [
    watchFileSystem(
      path.join(CORE_DIRECTORY, "index.ts"),
      scheduleSynchronization,
    ),
    watchFileSystem(
      SOURCE_DIRECTORY,
      { recursive: true },
      scheduleSynchronization,
    ),
  ];
}

/** Runs one conditional compilation or starts its long-lived watch mode. */
async function main() {
  const { isDebug, isWatch } = parseArguments();
  const modeName = isDebug ? "debug" : "no-debug";
  const stagingDirectory = path.join(CACHE_DIRECTORY, modeName);

  // The plugin snapshots `process.env` when it is created, so the debug flag
  // must be set before the plugin exists.
  process.env.DEBUG = String(isDebug);
  const plugin = unplugin.raw({
    include: /(?:^|[\\/])core[\\/](?:index|src[\\/].+)\.ts$/,
  });
  const preprocessor = resolvePreprocessor(plugin);

  await verifyPreprocessor(isDebug, preprocessor, PREPROCESSOR_PROBE_FILE);
  await mkdir(stagingDirectory, { recursive: true });
  await writeStagingConfig(stagingDirectory);
  await synchronizeSources(stagingDirectory, preprocessor);

  const compiler = startCompiler(stagingDirectory, isWatch);

  if (!isWatch) {
    compiler.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal === null ? 1 : 128);
    });
    return;
  }

  let isStopping = false;
  let watchers = [];
  const stop = (signal) => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    watchers.forEach((watcher) => watcher.close());
    compiler.kill(signal);
  };
  const handleSynchronizationError = (error) => {
    console.error("Failed to preprocess changed core sources.", error);
    stop("SIGTERM");
    process.exitCode = 1;
  };

  watchers = watchSources(
    () => synchronizeSources(stagingDirectory, preprocessor),
    handleSynchronizationError,
  );
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  compiler.once("exit", (code, signal) => {
    watchers.forEach((watcher) => watcher.close());

    if (!isStopping) {
      process.exitCode = code ?? (signal === null ? 1 : 128);
    }
  });
}

main().catch((error) => {
  console.error("Failed to build @reveriejs/core.", error);
  process.exitCode = 1;
});
