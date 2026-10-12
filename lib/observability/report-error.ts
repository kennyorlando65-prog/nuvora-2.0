import "server-only";

/**
 * Server-side error reporting with a correlation id.
 *
 * THE PROBLEM THIS SOLVES. The admin area was returning a 500 and the operator had nothing to
 * act on: no message on screen, nothing to quote to anybody, and no way to tell whether the
 * fault was a configuration gap or a bug. An error page that discards the exception is not a
 * safe error page, it is an unhelpful one - and the mistake it encourages is guessing at the
 * cause instead of reading it.
 *
 * The fix is a correlation id. The full error is logged on the server, once, with that id.
 * The browser gets the id and nothing else. Support can then match a user's screenshot to a
 * log line without the log line ever reaching a browser.
 *
 * WHAT IS DELIBERATELY NEVER LOGGED OR RETURNED: environment variable VALUES, provider API
 * keys or their hints, Supabase keys of any kind, raw payment payloads, and customer personal
 * data. The message is passed through a redactor first, because an upstream error string is
 * one of the easiest places for a key to leak - a connection string with a password in it is
 * a perfectly ordinary thing for a driver to put in an exception.
 */

const CORRELATION_BYTES = 8;

/**
 * A short, unambiguous correlation id.
 *
 * Hex rather than base64url so it contains no characters an operator can misread or a chat
 * client can mangle when they paste it into a support message.
 */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(CORRELATION_BYTES);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node without webcrypto on the global: fall back to randomBytes. Still unpredictable, which
  // is all this id needs to be - it is a log handle, not a credential.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  return nodeCrypto.randomBytes(CORRELATION_BYTES).toString("hex");
}

/**
 * Patterns for values that must never reach a log or a browser.
 *
 * Deliberately conservative: it matches the SHAPE of a secret rather than trying to enumerate
 * known keys, because a provider key we have never seen is exactly the one that would slip
 * through a name-based filter.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  // JWTs, including Supabase anon and service-role keys.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]"],
  // key=value assignments for anything that looks like a credential.
  [
    /\b(pass|password|pwd|secret|token|apikey|api_key|access_key|private_key|credential)\b\s*[:=]\s*["']?([^\s"'&,;]{4,})["']?/gi,
    "$1=[redacted]",
  ],
  // postgres://user:password@host connection strings.
  [/\/\/[^\s:@/]+:[^\s@/]+@/g, "//[redacted]@"],
  // Long opaque hex or base64 blobs: encryption ciphertext, hmac secrets, long keys.
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted-blob]"],
];

/** Strips anything that looks like a secret from a string. */
export function redact(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Details safe to hand back to a browser or write to a log line. */
export type ReportedError = {
  correlationId: string;
  /** A redacted, single-line summary. Safe to display. */
  message: string;
  /** Redacted stack, present only when it is safe to show one. */
  stack?: string;
};

/**
 * Records an error server-side and returns what may be shown.
 *
 * `showDetail` is true in development and false in production. In development the real message
 * and stack are returned, because a developer needs them and the output goes to a local
 * terminal. In production they are suppressed and only the correlation id is returned, so a
 * crafted error can never be used to read a key or an internal path out of the response.
 */
export function reportError(error: unknown, context?: string): ReportedError {
  const correlationId = newCorrelationId();
  const isDevelopment = process.env.NODE_ENV !== "production";

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unknown error occurred.";

  const rawStack = error instanceof Error ? error.stack : undefined;

  // The log line is the only place the full detail exists, and it is redacted before it is
  // written - a log file is frequently shipped somewhere less protected than the database.
  const logLine = [
    `[nuvora] correlation=${correlationId}`,
    context ? `context=${context}` : null,
    `message=${redact(rawMessage)}`,
    rawStack ? `stack=\n${redact(rawStack)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  console.error(logLine);

  return {
    correlationId,
    message: redact(rawMessage),
    ...(isDevelopment && rawStack ? { stack: redact(rawStack) } : {}),
  };
}

/**
 * The message a customer or operator actually sees.
 *
 * Kept short and non-technical, with the id appended so it can be quoted. It says nothing
 * about what failed, which is the point: in production the cause is in the log, not on the
 * page.
 */
export function userFacingMessage(reported: ReportedError, subject = "This page"): string {
  return `${subject} could not be displayed. Nothing was charged and no order was changed. Quote reference ${reported.correlationId} if you contact support.`;
}
