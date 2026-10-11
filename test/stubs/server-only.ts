/**
 * Test stub for the `server-only` package.
 *
 * The real package throws on import unless it is resolved under the `react-server`
 * bundler condition, which Next sets for Server Components and the Vitest runner does
 * not. Without this stub, every suite that imports a server module fails at collection
 * time.
 *
 * This file is wired in through vitest.config.ts and affects the TEST RUN ONLY. The
 * application build still uses the real package, so importing lib/env.ts or
 * lib/supabase/server.ts from a client component remains a build error - which is the
 * protection we actually want.
 */

export {};
