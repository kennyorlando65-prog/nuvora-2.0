import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * Browser Supabase client.
 *
 * Uses only publishable values, so everything it can reach is constrained by Row
 * Level Security. Never pass a service-role key here.
 */
export function getBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
