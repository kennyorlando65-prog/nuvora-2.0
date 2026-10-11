import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status",
  description:
    "Live configuration status of the NUVORA platform: whether the core services and secrets are wired up.",
};

export const dynamic = "force-dynamic";

/**
 * A PUBLIC status page.
 *
 * It reads the same facts as /api/health, but reports only what is safe to show a visitor:
 * which core services are configured, and which provider or payment mode the platform is
 * running in. It never prints a variable value, a prefix or a length.
 *
 * "Configured" is a truthful label. It means the required environment variables are
 * present, NOT that every supplier credential has been tested end to end - that is a
 * different check, and the wording below says so rather than overclaiming a green light.
 */

type Health = {
  status: string;
  missing?: string[];
  providerMode?: string;
  paymentProvider?: string;
  timestamp?: string;
};

const SERVICE_LABELS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "Database & authentication",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Public API key",
  SUPABASE_SERVICE_ROLE_KEY: "Privileged server reader",
};

async function readHealth(): Promise<Health> {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const response = await fetch(`${base}/api/health`, { cache: "no-store" });
    return (await response.json()) as Health;
  } catch {
    return { status: "unreachable" };
  }
}

export default async function StatusPage() {
  const health = await readHealth();
  const healthy = health.status === "configured";
  const missing = health.missing ?? [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="nuvora-label">Status</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Platform status</h1>

      <div
        className={`mt-6 nuvora-card flex items-start gap-3 p-5 ${
          healthy ? "" : "border-accent/50"
        }`}
      >
        <span
          aria-hidden="true"
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
            healthy ? "bg-ok" : "bg-accent"
          }`}
        />
        <div>
          <p className="text-sm font-semibold text-ink">
            {healthy
              ? "Core services are configured"
              : "Some core services are not configured"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {healthy
              ? "The platform has the environment variables it needs to reach the database, authenticate users and read privileged data. This confirms configuration, not that every supplier credential has been exercised end to end."
              : `Missing configuration: ${missing.join(", ") || "unknown"}. Until these are set in Vercel, parts of the platform cannot function.`}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line p-4">
          <dt className="font-mono text-xs uppercase tracking-widest text-dim">Provider mode</dt>
          <dd className="mt-1 text-sm text-ink">{health.providerMode ?? "unknown"}</dd>
        </div>
        <div className="rounded-lg border border-line p-4">
          <dt className="font-mono text-xs uppercase tracking-widest text-dim">Payments</dt>
          <dd className="mt-1 text-sm text-ink">{health.paymentProvider ?? "disabled"}</dd>
        </div>
      </dl>

      {Object.keys(SERVICE_LABELS).length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Core services</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {Object.entries(SERVICE_LABELS).map(([key, label]) => {
              const ok = !missing.includes(key);
              return (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-md border border-line-soft bg-panel-2 px-4 py-3"
                >
                  <span className="text-sm text-ink">{label}</span>
                  <span
                    className={`font-mono text-[11px] uppercase tracking-widest ${
                      ok ? "text-ok" : "text-bad"
                    }`}
                  >
                    {ok ? "configured" : "missing"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {health.timestamp && (
        <p className="mt-6 font-mono text-xs text-dim">
          Checked at {health.timestamp}
        </p>
      )}

      <p className="mt-8 text-xs leading-relaxed text-dim">
        This page reports configuration only and reveals no secret values. A full incident
        and uptime history is planned; until it exists, this page is the honest current
        state rather than a historical record.
      </p>
    </div>
  );
}
