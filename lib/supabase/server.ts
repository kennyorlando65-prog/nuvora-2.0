import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client.
 *
 * This client BYPASSES Row Level Security, so it must only ever be used inside
 * server-side code: route handlers, server actions and background jobs.
 *
 * The `server-only` import above turns any accidental client-side import into a build
 * error, which is the guard that keeps the service-role key out of the browser bundle.
 */
let cached: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { "x-nuvora-client": "server-service-role" },
    },
  });

  return cached;
}
