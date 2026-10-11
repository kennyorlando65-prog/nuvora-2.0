import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an inbound supplier callback.
 *
 * WHY THIS IS SEPARATE FROM THE GATEWAY VERIFIERS. Paystack and Flutterwave each have exactly one
 * scheme and their own header, so their verification lives with their client. Suppliers vary: some
 * sign with HMAC-SHA256 in hex, some in base64, some send a shared static secret, and some send
 * nothing at all. The scheme is therefore a column on the providers row and this module implements
 * the vocabulary that column draws from.
 *
 * THE ONE RULE: an unsigned or unverifiable callback may be RECORDED but must never be ACTED ON.
 * A callback that can move an order to 'fulfilled' without a valid signature is an open door -
 * anybody who guesses the URL could mark orders delivered, or report goods as cancelled, and the
 * store would believe them. The receiver logs valid:false and returns without processing.
 */

export type SignatureScheme =
  | "none"
  | "hmac_sha256_hex"
  | "hmac_sha256_base64"
  | "shared_header";

/**
 * Header names checked for a signature, in order.
 *
 * A list rather than a configured name because the header is chosen by the SUPPLIER's convention,
 * not by us, and every one of these is in real-world use. A supplier using something more exotic
 * needs its name added here - which is a one-line change, not a new integration.
 */
const SIGNATURE_HEADERS = [
  "x-nuvora-signature",
  "x-supplier-signature",
  "x-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
  "x-callback-signature",
] as const;

const SHARED_SECRET_HEADERS = [
  "x-nuvora-webhook-secret",
  "x-webhook-secret",
  "x-api-key",
  "authorization",
] as const;

/** Constant-time comparison that also tolerates differing lengths. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch, and comparing lengths first leaks only the
  // length - which is not a secret here.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

function readHeader(headers: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Strip the algorithm prefix some suppliers add, e.g. `sha256=abc...`.
 *
 * Kept separate so the comparison is done against the digest alone; comparing the whole header
 * against a bare digest would fail on every delivery for a supplier that uses the prefixed form.
 */
function stripPrefix(value: string): string {
  const separator = value.indexOf("=");
  if (separator > 0 && separator < 12) return value.slice(separator + 1).trim();
  return value;
}

export type SignatureVerdict = {
  valid: boolean;
  scheme: SignatureScheme;
  /** Why it failed. For the operator's log; never returned to the caller. */
  detail: string;
};

/**
 * Verify a callback.
 *
 * `rawBody` MUST be the exact bytes received. Parsing the JSON first and re-serialising would change
 * the whitespace and break an HMAC that the supplier computed correctly - and the usual "fix" for
 * that is to stop verifying, which is how these schemes get abandoned.
 */
export function verifySupplierSignature(args: {
  scheme: SignatureScheme;
  secret: string | null;
  rawBody: string;
  headers: Headers;
}): SignatureVerdict {
  const { scheme, secret, rawBody, headers } = args;

  if (scheme === "none") {
    // Explicitly configured as unsigned. Permitted, but the receiver still records the callback as
    // unverified, and the admin completeness panel flags it as a posture an operator chose.
    return {
      valid: true,
      scheme,
      detail: "Provider declares no signature scheme; callback accepted unverified by configuration.",
    };
  }

  if (!secret) {
    // The schema refuses to store a signing scheme with no secret, so reaching this means the row
    // was written before that constraint or by a path that bypassed it. Either way, refusing is the
    // only safe response.
    return {
      valid: false,
      scheme,
      detail: "No webhook secret is stored for this provider, so the signature cannot be verified.",
    };
  }

  if (scheme === "shared_header") {
    const presented = readHeader(headers, SHARED_SECRET_HEADERS);
    if (!presented) {
      return { valid: false, scheme, detail: "No shared-secret header was present." };
    }

    // Some send the raw secret in `authorization` with a Bearer prefix stripped off.
    const candidate = presented.toLowerCase().startsWith("bearer ")
      ? presented.slice(7).trim()
      : stripPrefix(presented);

    return constantTimeEqual(candidate, secret)
      ? { valid: true, scheme, detail: "Shared secret matched." }
      : { valid: false, scheme, detail: "Shared secret did not match." };
  }

  const presented = readHeader(headers, SIGNATURE_HEADERS);
  if (!presented) {
    return {
      valid: false,
      scheme,
      detail: `No signature header found. Looked for: ${SIGNATURE_HEADERS.join(", ")}.`,
    };
  }

  const expected =
    scheme === "hmac_sha256_hex"
      ? createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
      : createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const candidate = stripPrefix(presented);

  // Hex is case-insensitive by convention, so compare lowercased; base64 is not, so compare as-is.
  const matches =
    scheme === "hmac_sha256_hex"
      ? constantTimeEqual(candidate.toLowerCase(), expected.toLowerCase())
      : constantTimeEqual(candidate, expected);

  return matches
    ? { valid: true, scheme, detail: "HMAC signature matched." }
    : { valid: false, scheme, detail: "HMAC signature did not match the request body." };
}
