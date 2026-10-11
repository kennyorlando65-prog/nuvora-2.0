import { describe, expect, it } from "vitest";

import { clientKeyFrom, rateLimit } from "./ratelimit";

describe("rateLimit", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    const args = { key: "k1", limit: 3, windowMs: 1000, now: 1_000_000 };
    expect(rateLimit(args).allowed).toBe(true);
    expect(rateLimit(args).allowed).toBe(true);
    expect(rateLimit(args).allowed).toBe(true);

    const blocked = rateLimit(args);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key independently", () => {
    const base = { limit: 1, windowMs: 1000, now: 2_000_000 };
    expect(rateLimit({ ...base, key: "a" }).allowed).toBe(true);
    expect(rateLimit({ ...base, key: "b" }).allowed).toBe(true);
    expect(rateLimit({ ...base, key: "a" }).allowed).toBe(false);
  });

  it("resets once the window has passed", () => {
    const base = { key: "k2", limit: 1, windowMs: 1000 };
    expect(rateLimit({ ...base, now: 3_000_000 }).allowed).toBe(true);
    expect(rateLimit({ ...base, now: 3_000_500 }).allowed).toBe(false);
    expect(rateLimit({ ...base, now: 3_001_001 }).allowed).toBe(true);
  });
});

describe("clientKeyFrom", () => {
  it("uses the first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientKeyFrom(headers, "checkout")).toBe("checkout:203.0.113.7");
  });

  it("falls back to a shared key so a missing header degrades to a GLOBAL limit", () => {
    // The alternative - returning a unique key per request - would mean no limit at all.
    expect(clientKeyFrom(new Headers(), "checkout")).toBe("checkout:unknown");
  });

  it("prefers the forwarded header over x-real-ip", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
    expect(clientKeyFrom(headers, "ns")).toBe("ns:1.2.3.4");
  });
});
