import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for supplier credentials at rest.
 *
 * WHY THIS EXISTS RATHER THAN STORING THE KEY IN AN ENVIRONMENT VARIABLE.
 * An environment variable is the right place for a key the process itself uses. A supplier
 * API key is different: it is one of MANY, it changes when the operator adds a supplier
 * through the admin UI, and it must be readable back by the server at fulfilment time -
 * which an env var cannot support without a redeploy per supplier. Env-var-only storage
 * would also make the admin UI a lie, because the "add a provider" form would have nowhere
 * to put the key.
 *
 * THE TRADE, STATED PLAINLY. Encryption at rest protects the ciphertext if the DATABASE is
 * exposed - a leaked backup, a misconfigured read, a support screenshot of a table. It does
 * NOT protect against a compromise of the server process, because the process holds the
 * encryption key in order to decrypt. Nothing can fix that; a server must be able to read
 * the credential it is about to use. What this design buys is that a database disclosure
 * alone yields nothing usable, which is the realistic threat for a small team.
 *
 * WHERE THE CIPHERTEXT IS STORED, AND WHERE IT MUST NOT BE.
 * `suppliers.credential_ciphertext` and `suppliers.webhook_secret_ciphertext` are REMOVED
 * from the anon/authenticated column grants, so no browser session can read them - not even
 * an admin one. Only the service role can, and it is only ever decrypted server-side inside
 * a route handler immediately before an outbound call.
 *
 * KEY MISMANAGEMENT IS THE REAL FAILURE MODE, so it is handled explicitly:
 *   - A missing key does not silently fall back to plaintext. `encryptSecret` THROWS.
 *   - A key that is not 32 bytes when decoded THROWS at first use, with the expected format
 *     spelled out, rather than producing ciphertext nobody can ever decrypt.
 *   - A rotation makes existing ciphertext undecryptable, and that is reported as a
 *     distinguishable error ("the key may have been rotated") instead of a generic failure,
 *     because the operator needs to know to re-enter the credential.
 */

const KEY_ENV_VAR = "NUVORA_ENCRYPTION_KEY";

/** Algorithm constants, declared once so encryption and decryption cannot drift apart. */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;
const PREFIX = "v1";

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      `Supplier credential encryption is unavailable: ${KEY_ENV_VAR} is not set. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ` +
        `and add it to Vercel as a server-only variable. It must never be exposed to the browser, ` +
        `and it must never be committed.`,
    );
    this.name = "EncryptionKeyMissingError";
  }
}

export class EncryptionKeyInvalidError extends Error {
  constructor(detail: string) {
    super(`${KEY_ENV_VAR} is not usable: ${detail}`);
    this.name = "EncryptionKeyInvalidError";
  }
}

export class DecryptionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "DecryptionError";
  }
}

/** Reads and validates the key. Throws rather than degrading to plaintext storage. */
function getKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR];
  if (!raw || raw.trim() === "") throw new EncryptionKeyMissingError();

  const trimmed = raw.trim();

  // Accept base64 (the documented format) or 64 hex characters, because both are what people
  // produce when told "give me 32 bytes". Anything else is rejected with the expected shape.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      key = Buffer.from(trimmed, "base64");
    } catch {
      throw new EncryptionKeyInvalidError("it is neither valid base64 nor 64 hex characters.");
    }
  }

  if (key.length !== 32) {
    throw new EncryptionKeyInvalidError(
      `it decodes to ${key.length} bytes, but AES-256 requires exactly 32. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  return key;
}

/** True when a usable key is configured. Used to disable the form rather than fail on submit. */
export function isEncryptionAvailable(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a secret.
 *
 * The stored string is `v1.<iv>.<tag>.<ciphertext>`, all base64. The version prefix exists so
 * a future key or algorithm change can be detected and migrated rather than guessed at - an
 * unprefixed blob would be indistinguishable from a corrupted one.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypts a secret.
 *
 * GCM authenticates as well as encrypts, so a tampered ciphertext fails here rather than
 * being used. That is the property that makes storing the credential in a database row
 * acceptable at all.
 */
export function decryptSecret(stored: string): string {
  const key = getKey();

  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new DecryptionError("The stored credential is not in the expected format.");
  }

  // Bound to local names rather than destructured in place: with noUncheckedIndexedAccess every
  // destructured element is `string | undefined`, and Buffer.from would be given a possibly
  // undefined argument. Asserting the length above is the real check; these four lines make that
  // check visible to the compiler rather than silencing it with a non-null assertion.
  const ivPart = parts[1];
  const tagPart = parts[2];
  const dataPart = parts[3];

  if (!ivPart || !tagPart || !dataPart) {
    throw new DecryptionError("The stored credential is incomplete.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The overwhelmingly likely cause, and the one an operator can act on.
    throw new DecryptionError(
      `The stored credential could not be decrypted. ${KEY_ENV_VAR} may have been rotated or ` +
        `changed since this credential was saved, in which case the credential must be ` +
        `re-entered through the providers page.`,
    );
  }
}

/**
 * The last four characters, for a masked indicator in the UI.
 *
 * Stored as its own column rather than derived, because deriving it would mean decrypting
 * on every page render purely to display four characters.
 */
export function credentialHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return "";
  return trimmed.slice(-4);
}

/** A masked display value. Never derived from the ciphertext. */
export function maskHint(hint: string | null | undefined): string {
  if (!hint) return "not set";
  return `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${hint}`;
}

/**
 * A stable, salted hash of an IP address.
 *
 * Used for rate limiting and fraud review. The IP is never stored in the clear, because an
 * IP address is personal data under both the NDPA and the GDPR, and a hash with a per-project
 * salt is enough to recognise a repeat offender without retaining the identifier itself.
 * Without the salt configured this returns null rather than hashing unsalted, since an
 * unsalted hash of an IPv4 address is trivially reversible by brute force.
 */
export function hashIp(ip: string): string | null {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Constant-time comparison for a shared secret.
 *
 * `a === b` on secrets leaks length and, in some engines, early-exit timing information.
 * Both sides are hashed first so the comparison is always over equal-length inputs.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
