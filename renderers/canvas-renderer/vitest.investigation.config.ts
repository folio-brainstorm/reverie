import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/profiles/**/*.browser.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        {
          browser: "chromium",
          name: "chromium",
          provider: playwright({ launchOptions: { channel: "chromium" } }),
        },
      ],
    },
  },
});
