// Minimal Vitest config. Without it, Vitest would load vite.config.ts and
// start the Cloudflare plugin, which the plain-code tests don't need.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"]
  }
});
