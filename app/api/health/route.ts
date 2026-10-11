import { NextResponse } from "next/server";

/**
 * Liveness and configuration check.
 *
 * Reports ONLY whether each required variable is present - never a value, never a
 * prefix, never a length. Safe to expose publicly and useful right after a Vercel
 * deploy to confirm environment variables actually landed.
 */
export const dynamic = "force-dynamic";

const REQUIRED_SERVER = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function GET() {
  const missing = REQUIRED_SERVER.filter((name) => !process.env[name]);

  return NextResponse.json(
    {
      service: "nuvora-platform",
      status: missing.length === 0 ? "configured" : "unconfigured",
      missing,
      providerMode: process.env.PROVIDER_MODE ?? "sandbox",
      paymentProvider: process.env.PAYMENT_PROVIDER ?? "disabled",
      timestamp: new Date().toISOString(),
    },
    {
      status: missing.length === 0 ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
