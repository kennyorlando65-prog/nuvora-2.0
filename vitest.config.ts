import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest configuration.
 *
 * The `@/` alias must resolve here too, otherwise tests importing application modules
 * by absolute path fail while the Next build succeeds - a confusing split that hides
 * real breakage until deploy time.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // The pricing engine is pure and must stay that way: a test that needs the network
    // is a sign the logic drifted into a route handler.
    globals: false,
  },
});
