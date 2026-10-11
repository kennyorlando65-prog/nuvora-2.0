import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * Request-scoped Supabase client for Server Components, Server Actions and Route
 * Handlers.
 *
 * This is the client that makes `auth.uid()` and `public.is_admin()` work: it carries the
 * signed-in user's access token on every PostgREST call, so Row Level Security evaluates
 * the policies as THAT user. The service-role client in `lib/supabase/server.ts` does the
 * opposite - it bypasses RLS entirely - which is why the two are kept in separate modules
 * with separate names rather than behind one flag somebody could pass wrongly.
 *
 * A NEW CLIENT PER REQUEST, deliberately. It reads the request's cookie jar, so caching it
 * across requests would hand one visitor another visitor's session.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is expected, not an error: the
          // token refresh path is handled by middleware.ts, which CAN set them. Swallowing
          // this here is what stops a read-only render from throwing on a refresh.
        }
      },
    },
    global: {
      headers: { "x-nuvora-client": "server-user-scoped" },
    },
  });
}
