import "server-only";

/**
 * Typed, build-safe environment access.
 *
 * Values are read lazily through getters so that `next build` never fails when a
 * variable is absent at build time - missing configuration surfaces at the moment the
 * value is actually used, with a message naming the variable and where to set it.
 */

const REMEDY =
  "Set it in Vercel -> Project -> Settings -> Environment Variables (or .env.local for " +
  "local development). Never commit the value and never paste it into chat.";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}. ${REMEDY}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/** Server-only configuration. Reading these from client code is a build error. */
export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get siteUrl() {
    return optional("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  },
  get providerMode(): "sandbox" | "live" {
    return optional("PROVIDER_MODE", "sandbox").toLowerCase() === "live"
      ? "live"
      : "sandbox";
  },
  get paymentProvider(): "paystack" | "flutterwave" | "disabled" {
    const raw = optional("PAYMENT_PROVIDER", "disabled").toLowerCase();
    if (raw === "paystack" || raw === "flutterwave") return raw;
    return "disabled";
  },
} as const;

/**
 * Public configuration. Safe to reference from client components; these values are
 * compiled into the bundle, so a secret must never be placed here.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}
