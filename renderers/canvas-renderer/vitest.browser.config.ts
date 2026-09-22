import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const chromiumChannel = process.env["REVERIE_CHROMIUM_CHANNEL"];

export default defineConfig({
  test: {
    include: ["test/browser/**/*.browser.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances:
        chromiumChannel === undefined
          ? [{ browser: "chromium" }, { browser: "firefox" }]
          : [
              {
                browser: "chromium",
                name: chromiumChannel,
                provider: playwright({
                  launchOptions: { channel: chromiumChannel },
                }),
              },
            ],
    },
  },
});
