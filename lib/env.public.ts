/**
 * Public environment values.
 *
 * WHY THIS FILE EXISTS SEPARATELY.
 * `lib/env.ts` begins with `import "server-only"`, which turns any client-side import of
 * it into a build error. That is the right guard for `serverEnv` - but it also made
 * `publicEnv` unreachable from a client component, and `lib/supabase/browser.ts` re-exported
 * it from there. The moment anything browser-side imported the browser client, the build
 * would have failed with a message about `server-only` that says nothing about the real
 * cause. Splitting the public values out fixes that at the source rather than by wrapping
 * the symptom.
 *
 * Everything here is compiled into the client bundle. A secret must NEVER be added to
 * this object.
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}
