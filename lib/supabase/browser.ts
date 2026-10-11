import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env.public";

/**
 * Browser Supabase client.
 *
 * Uses only publishable values, so everything it can reach is constrained by Row Level
 * Security. Never pass a service-role key here.
 *
 * It imports from `lib/env.public` and NOT from `lib/env`, and that is a fix rather than a
 * taste preference: `lib/env.ts` opens with `import "server-only"`, so importing the
 * browser client from any client component - the entire purpose of this file - would have
 * failed the build with a `server-only` error that points at the wrong cause.
 */
export function getBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
