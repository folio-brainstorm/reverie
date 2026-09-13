import { defineConfig } from "vitest/config";
import PreprocessorDirectives from "unplugin-preprocessor-directives/vite";

export default defineConfig(({ mode }) => {
  process.env.DEBUG = String(mode !== "no-debug");

  return {
    plugins: [PreprocessorDirectives()],
  };
});
