import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "./errors";
import { SANDBOX_PAYLOAD_MARKER, createSandboxEsimAdapter } from "./esim-sandbox";
import { createLiveEsimAdapter } from "./esim-live";
import {
  readAdapterConfig,
  resolveAdapter,
  type AdapterConfig,
} from "./index";

function config(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    mode: "sandbox",
    isProduction: false,
    allowSandboxInProduction: false,
    esim: {},
    sandbox: {},
    ...overrides,
  };
}

const fulfReq = {
  supplierReference: "ESIM-NG-5GB",
  quantity: 1,
  idempotencyKey: "line-0001",
};

// --- sandbox adapter ---------------------------------------------------------

describe("sandbox eSIM adapter", () => {
  it("is explicitly labelled as sandbox in every result", async () => {
    const adapter = createSandboxEsimAdapter();
    expect(adapter.isSandbox).toBe(true);
    expect(adapter.mode).toBe("sandbox");

    const result = await adapter.fulfil(fulfReq);
    expect(result.isSandbox).toBe(true);
    expect(result.mode).toBe("sandbox");
  });

  it("stamps a visible marker inside the deliverable itself", async () => {
    // The marker is the safety net: a sandbox code that reaches a customer has to be
    // identifiable as one at a glance, not only in a database column.
    const result = await createSandboxEsimAdapter().fulfil(fulfReq);
    expect(result.deliveryPayload?.notice).toBe(SANDBOX_PAYLOAD_MARKER);
    expect(JSON.stringify(result.deliveryPayload)).toContain(SANDBOX_PAYLOAD_MARKER);
  });

  it("is deterministic: the same request yields the same deliverable", async () => {
    const a = await createSandboxEsimAdapter().fulfil(fulfReq);
    const b = await createSandboxEsimAdapter().fulfil(fulfReq);
    expect(a.deliveryPayload).toEqual(b.deliveryPayload);
  });

  it("changes the deliverable when the idempotency key changes", async () => {
    const a = await createSandboxEsimAdapter().fulfil(fulfReq);
    const b = await createSandboxEsimAdapter().fulfil({ ...fulfReq, idempotencyKey: "line-0002" });
    expect(a.deliveryPayload?.activationCode).not.toBe(b.deliveryPayload?.activationCode);
  });

  it("IS IDEMPOTENT: a repeated key returns the original result, it does not deliver twice", async () => {
    const adapter = createSandboxEsimAdapter();
    const first = await adapter.fulfil(fulfReq);
    const second = await adapter.fulfil(fulfReq);

    // Same object identity proves nothing re-ran. This is the property that makes a
    // retry after a timeout safe.
    expect(second).toBe(first);
  });

  it("reports a completed fulfilment through getStatus", async () => {
    const adapter = createSandboxEsimAdapter();
    await adapter.fulfil(fulfReq);
    const status = await adapter.getStatus("line-0001");
    expect(status?.state).toBe("completed");
  });

  it("returns null from getStatus for an unknown key, which is what makes a safe retry possible", async () => {
    const adapter = createSandboxEsimAdapter();
    expect(await adapter.getStatus("never-seen")).toBeNull();
  });

  it("can simulate a failure, and does not cache it as a success", async () => {
    const adapter = createSandboxEsimAdapter({ outcome: "failed" });
    const result = await adapter.fulfil(fulfReq);
    expect(result.state).toBe("failed");
    expect(result.deliveryPayload).toBeNull();
    expect(result.error?.retryable).toBe(true);
  });

  it("can simulate pending, and does not cache a pending fulfilment", async () => {
    const adapter = createSandboxEsimAdapter({ outcome: "pending" });
    const first = await adapter.fulfil(fulfReq);
    expect(first.state).toBe("pending");
    expect(first.deliveryPayload).toBeNull();
    // Pending must not be remembered as terminal, or a later poll would never see it
    // resolve - mirroring how a real supplier behaves.
    expect(await adapter.getStatus("line-0001")).toBeNull();
  });

  it("rejects a missing idempotency key rather than delivering unguarded", async () => {
    const adapter = createSandboxEsimAdapter();
    await expect(adapter.fulfil({ ...fulfReq, idempotencyKey: "  " })).rejects.toThrow(/idempotencyKey is required/);
  });

  it("rejects a bad quantity", async () => {
    const adapter = createSandboxEsimAdapter();
    for (const quantity of [0, -1, 1.5, 101]) {
      await expect(adapter.fulfil({ ...fulfReq, quantity })).rejects.toThrow(/quantity must be/);
    }
  });

  it("quotes in the requested currency and claims no catalogue of its own", async () => {
    const adapter = createSandboxEsimAdapter({ simulatedUnitCostMinor: 400_000n });
    const quote = await adapter.quote({
      supplierReference: "ESIM-NG-5GB",
      productLine: "esim",
      quantity: 1,
      currency: "NGN",
    });
    expect(quote.unitCostMinor).toBe(400_000n);
    expect(quote.currency).toBe("NGN");
    expect(quote.isSandbox).toBe(true);
  });

  it("reports healthy without any network access", async () => {
    const health = await createSandboxEsimAdapter().health();
    expect(health.ok).toBe(true);
    expect(health.isSandbox).toBe(true);
  });
});

// --- registry ----------------------------------------------------------------

describe("adapter registry", () => {
  it("returns the sandbox adapter when mode is sandbox", () => {
    const adapter = resolveAdapter("esim-sandbox", config());
    expect(adapter.key).toBe("esim-sandbox");
    expect(adapter.isSandbox).toBe(true);
  });

  it("REFUSES to run sandbox on a production deployment", () => {
    // The whole point: a live store must not silently sell simulated goods.
    expect(() => resolveAdapter("esim-sandbox", config({ isProduction: true }))).toThrow(
      ProviderError,
    );
    expect(() => resolveAdapter("esim-sandbox", config({ isProduction: true }))).toThrow(
      /sandbox supplier on a production deployment/,
    );
  });

  it("allows sandbox in production only with the explicit opt-out", () => {
    const adapter = resolveAdapter(
      "esim-sandbox",
      config({ isProduction: true, allowSandboxInProduction: true }),
    );
    expect(adapter.isSandbox).toBe(true);
  });

  it("allows sandbox outside production without the opt-out", () => {
    expect(resolveAdapter("esim-sandbox", config({ isProduction: false })).isSandbox).toBe(true);
  });

  it("refuses live mode when supplier credentials are missing", () => {
    expect(() => resolveAdapter("esim-live", config({ mode: "live" }))).toThrow(ProviderError);
    expect(() => resolveAdapter("esim-live", config({ mode: "live" }))).toThrow(
      /ESIM_PROVIDER_BASE_URL and ESIM_PROVIDER_API_KEY/,
    );
  });

  it("names only the credential that is actually missing", () => {
    expect(() =>
      resolveAdapter(
        "esim-live",
        config({ mode: "live", esim: { baseUrl: "https://supplier.example.com" } }),
      ),
    ).toThrow(/requires ESIM_PROVIDER_API_KEY to be set/);
  });

  it("builds a live adapter when mode and credentials are both present", () => {
    const adapter = resolveAdapter(
      "esim-live",
      config({
        mode: "live",
        esim: { baseUrl: "https://supplier.example.com", apiKey: "not-a-real-key" },
      }),
    );
    expect(adapter.key).toBe("esim-live");
    expect(adapter.isSandbox).toBe(false);
    expect(adapter.mode).toBe("live");
  });

  it("refuses a plain-http supplier endpoint, which would leak our key", () => {
    expect(() =>
      resolveAdapter(
        "esim-live",
        config({ mode: "live", esim: { baseUrl: "http://supplier.example.com", apiKey: "k" } }),
      ),
    ).toThrow(/must use https/);
  });

  it("defaults to sandbox when PROVIDER_MODE is absent or unrecognised", () => {
    expect(readAdapterConfig({}).mode).toBe("sandbox");
    expect(readAdapterConfig({ PROVIDER_MODE: "PRODUCTION" }).mode).toBe("sandbox");
    expect(readAdapterConfig({ PROVIDER_MODE: "LIVE" }).mode).toBe("live");
  });

  it("detects a production deployment only through VERCEL_ENV", () => {
    // Local `npm run build && npm start` sets NODE_ENV=production but must NOT trip the
    // sandbox guard, or nobody could run the built app locally.
    expect(readAdapterConfig({ NODE_ENV: "production" }).isProduction).toBe(false);
    expect(readAdapterConfig({ VERCEL_ENV: "production" }).isProduction).toBe(true);
    expect(readAdapterConfig({ VERCEL_ENV: "preview" }).isProduction).toBe(false);
  });
});

// --- live adapter ------------------------------------------------------------

describe("live eSIM adapter", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("sends the idempotency key to the supplier", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "completed", payload: { code: "X" } }));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await adapter.fulfil(fulfReq);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ key: "line-0001" });
  });

  it("maps an unknown status to an error instead of assuming success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "banana", payload: {} }));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fulfil(fulfReq)).rejects.toThrow(/unrecognised supplier fulfilment status/);
  });

  it("refuses a completion with no payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "completed" }));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fulfil(fulfReq)).rejects.toThrow(/without a delivery payload/);
  });

  it("does NOT retry a rejected credential", async () => {
    // Retrying a 401 burns the supplier's rate limit and looks like an attack.
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 401));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "bad",
      maxAttempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fulfil(fulfReq)).rejects.toThrow(/rejected our credentials/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "boom" }, 503);
      return jsonResponse({ status: "completed", payload: { code: "X" } });
    });
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      maxAttempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.fulfil(fulfReq);
    expect(result.state).toBe("completed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a quote in the wrong currency rather than silently corrupting the margin", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ cost_minor: 100, currency: "USD" }));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      adapter.quote({ supplierReference: "X", productLine: "esim", quantity: 1, currency: "NGN" }),
    ).rejects.toThrow(/quoted USD but we expected NGN/);
  });

  it("treats an unknown fulfilment as null rather than an error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not found" }, 404));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await adapter.getStatus("line-0001")).toBeNull();
  });

  it("reports an unhealthy probe as ok:false without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 401));
    const adapter = createLiveEsimAdapter({
      baseUrl: "https://supplier.example.com",
      apiKey: "super-secret-key-value",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain("super-secret-key-value");
    expect(health.detail).toContain("unauthorized");
  });
});
