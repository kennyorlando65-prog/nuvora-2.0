import type { NextConfig } from "next";

/**
 * Security headers are applied at the edge on Vercel, so every route inherits
 * them without per-route work.
 *
 * NOTE ON CSP: Next.js injects inline bootstrap scripts, so `'unsafe-inline'` is
 * currently required for script-src. Tightening this to a nonce-based policy is a
 * launch-hardening task, tracked in README ("Before launch").
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Stops the browser speculatively resolving hostnames found in page content. Nothing in
  // this app needs it, and it is a small amount of information a visitor did not ask to
  // leak to their DNS resolver.
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // No Flash or PDF cross-domain policy files are served, so nothing should be allowed to
  // load one from this origin.
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never let a build silently succeed with a type error.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Cap static-generation parallelism instead of letting Next spawn one worker per CPU.
    //
    // This is not a micro-optimisation, it is what makes the build complete in a
    // memory-capped container. Next reads the HOST's CPU count, not the container's memory
    // limit: this sandbox advertises 48 CPUs while its cgroup allows 2 GB, so the build
    // launched dozens of parallel workers into a 2 GB budget and the kernel OOM-killed the
    // process mid-way through "Generating static pages". The failure looked like a code
    // fault and was purely a resource mismatch.
    //
    // Two workers is enough that the build stays quick and low enough that peak memory
    // stays inside a capped runner. Vercel's build containers are memory-capped in the same
    // way, so this is the correct setting for them too rather than a sandbox workaround.
    cpus: 2,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
