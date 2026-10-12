import { NextResponse } from "next/server";

import { createOrder } from "@/lib/checkout/create-order";
import { getSessionUser } from "@/lib/auth/guard";
import { PaymentError } from "@/lib/payments/errors";
import { PricingError } from "@/lib/pricing";
import { clientKeyFrom, rateLimit } from "@/lib/ratelimit";

/**
 * Checkout.
 *
 * POST a basket of product ids and quantities. The response is an order number and a URL
 * to send the customer to. Prices are NEVER accepted from the client: the request has no
 * price field that is read, and a volunteered price is treated only as a tampering signal.
 *
 * A CONFIRMED ACCOUNT IS REQUIRED, and this is enforced here rather than left to the page.
 * It used to be enforced nowhere: the /checkout PAGE required a session, but this route did
 * not, so an anonymous caller could POST a basket with any email address and have a real,
 * payable order created against it. The page was a suggestion; this is the boundary.
 *
 * Runs on the Node runtime because it uses node:crypto and BigInt money arithmetic.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous body cap. A basket of 50 lines is a few KB; anything larger is not a basket. */
const MAX_BODY_BYTES = 32 * 1024;

/**
 * Per-instance throttle. See lib/ratelimit.ts for the honest scope - this needs a durable
 * store before launch.
 */
const CHECKOUT_LIMIT = 20;
const CHECKOUT_WINDOW_MS = 60_000;

/**
 * Map a failure to an HTTP response WITHOUT leaking internals.
 *
 * PricingError and PaymentError messages are written for humans and contain no secret -
 * they name a field or a variable, never a value. Anything else is reported generically
 * and must be read from the server log.
 */
function errorResponse(error: unknown): NextResponse {
  if (error instanceof PricingError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  if (error instanceof PaymentError) {
    // 503 rather than 500: the store is temporarily unable to take payment, which is a
    // different situation from a bug.
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  console.error("[checkout] unhandled error", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Checkout could not be completed. Please try again." } },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit({
    key: clientKeyFrom(request.headers, "checkout"),
    limit: CHECKOUT_LIMIT,
    windowMs: CHECKOUT_WINDOW_MS,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many attempts. Please wait a moment." } },
      { status: 429, headers: { "retry-after": String(limit.retryAfter), "cache-control": "no-store" } },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: "payload_too_large", message: "That basket is too large." } },
      { status: 413, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: { code: "payload_too_large", message: "That basket is too large." } },
        { status: 413, headers: { "cache-control": "no-store" } },
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "The request body is not valid JSON." } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Expected a JSON object." } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const input = body as Record<string, unknown>;

  /**
   * -- THE GATE: A SIGNED-IN ACCOUNT WITH A CONFIRMED ADDRESS --
   *
   * Order of the checks, and why each is where it is:
   *
   *   1. The session comes from `getUser()`, which validates the access token against the
   *      auth server. Reading the cookie directly would accept a forged one.
   *   2. Confirmation is read from the verified user record, so it cannot be asserted by
   *      the caller. This is the part that has to be real: an order is delivered by email,
   *      so an unconfirmed address is an address we may not be able to reach, and taking
   *      someone's money for goods we cannot deliver is the worst failure this product has.
   *   3. Only then is the order created, with the owner taken from the session.
   *
   * The refusal is a real HTTP status, not a redirect to a sign-in form. A redirect would
   * hand a fetch() caller a login page with a 200 and look like success to anything that only
   * checks the status code - which is how a broken gate passes its own test.
   */
  const { user } = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "Sign in before placing an order.",
        },
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const accountEmail = user.email ?? "";

  if (!accountEmail) {
    return NextResponse.json(
      {
        error: {
          code: "no_account_email",
          message: "This account has no email address, so an order cannot be delivered.",
        },
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  if (!user.email_confirmed_at) {
    return NextResponse.json(
      {
        error: {
          code: "email_unconfirmed",
          message:
            "Confirm your email address before placing an order. Your codes and receipt are delivered to that address, so we cannot take payment until it is confirmed.",
        },
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await createOrder({
      lines: Array.isArray(input.lines)
        ? input.lines.map((line) => {
            const entry = (typeof line === "object" && line !== null ? line : {}) as Record<
              string,
              unknown
            >;
            return {
              productId: String(entry.productId ?? ""),
              quantity: Number(entry.quantity),
              // Carried through purely so the server can detect and log tampering. It is
              // never read into a calculation.
              ...(entry.clientUnitPriceMinor !== undefined
                ? { clientUnitPriceMinor: entry.clientUnitPriceMinor }
                : {}),
            };
          })
        : [],
      email: String(input.email ?? ""),
      // Taken from the verified session, never from the request body. createOrder also
      // requires the delivery address to match this, so a forged `email` is refused rather
      // than silently honoured.
      userId: user.id,
      authenticatedEmail: accountEmail,
      idempotencyKey: String(input.idempotencyKey ?? ""),
      ...(typeof input.billingCountry === "string"
        ? { billingCountry: input.billingCountry.toUpperCase() }
        : {}),
      ...(request.headers.get("x-forwarded-for")
        ? { clientIp: request.headers.get("x-forwarded-for")!.split(",")[0]!.trim() }
        : {}),
    });

    return NextResponse.json(
      {
        orderNumber: result.orderNumber,
        currency: result.currency,
        // bigint cannot be JSON-serialised, so the amount travels as a string of minor
        // units. The client formats it for display; it never sends it back.
        amountMinor: result.totalMinor.toString(),
        authorizationUrl: result.authorizationUrl,
        providerReference: result.providerReference,
        reused: result.reused,
        engineVersion: result.engineVersion,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
