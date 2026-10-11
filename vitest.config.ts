import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest configuration.
 *
 * Two things are resolved here that matter for correctness:
 *
 * 1. The `@/` alias must resolve here too, otherwise tests importing application modules
 *    by absolute path fail while the Next build succeeds - a confusing split that hides
 *    real breakage until deploy time.
 *
 * 2. `server-only` is stubbed. That package exists to throw if a server module is pulled
 *    into a client bundle, and it detects a React Server Component through a bundler
 *    condition the test runner does not set. Left as-is it makes every suite that imports
 *    a server module fail to collect, which would push us toward not marking modules
 *    server-only at all - the opposite of what we want. The stub is applied ONLY to the
 *    test run; `next build` still resolves the real package and still fails the build if
 *    client code imports a server module.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // The pricing engine and the provider adapters are pure apart from injected fetches:
    // a test that needs real network access is a sign logic drifted into a route handler.
    globals: false,
  },
});
