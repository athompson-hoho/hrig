import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/mobile",
  workers: 1,
  use: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
});
