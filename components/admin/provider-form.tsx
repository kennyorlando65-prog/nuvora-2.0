import { maskHint } from "@/lib/crypto/secret-box";
import {
  AUTH_SCHEMES,
  IMPLEMENTATIONS,
  MODES,
  PROVIDER_ERRORS,
  WEBHOOK_SCHEMES,
  type ProviderRow,
} from "@/lib/admin/providers";
import { AUTH_SCHEME_LABELS, WEBHOOK_SCHEME_LABELS } from "@/lib/admin/format";

/**
 * Provider configuration form.
 *
 * THE CREDENTIAL FIELD IS A WRITE-ONLY PASSWORD INPUT, AND THAT IS THE POINT.
 * Once a key is saved it is never rendered back - not masked-and-revealable, not in a data
 * attribute, not in the HTML at all. The server cannot return it, because the ciphertext column
 * is removed from the authenticated column grants, so there is nothing to render. What the
 * operator sees instead is a stored hint ("********1234") and a note that leaving the field
 * blank keeps the existing key. An empty box is therefore meaningful, and the form says so
 * rather than leaving it to be guessed.
 *
 * The mapping textarea is a raw JSON field. That is deliberate and slightly unfriendly: the
 * mapping is genuinely structured data that a supplier's documentation produces, and inventing
 * a bespoke form for each supplier's field names would be a worse lie than showing the JSON.
 * The requirements panel beside it says exactly which keys are looked for.
 */

const FIELD =
  "rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-dim focus:border-accent focus:outline-none";

function Label({
  children,
  hint,
  htmlFor,
}: {
  children: React.ReactNode;
  hint?: string;
  htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="nuvora-label">{children}</span>
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  );
}

export function ProviderForm({
  action,
  provider,
  hasStoredCredential,
  hasStoredWebhookSecret,
  submitLabel,
  isUpdate,
}: {
  action: (formData: FormData) => Promise<void>;
  provider?: ProviderRow;
  hasStoredCredential: boolean;
  hasStoredWebhookSecret: boolean;
  submitLabel: string;
  isUpdate: boolean;
}) {
  const mappingJson =
    provider && Object.keys(provider.request_mapping ?? {}).length > 0
      ? JSON.stringify(provider.request_mapping, null, 2)
      : "";

  return (
    <form action={action} className="flex flex-col gap-5">
      {isUpdate && <input type="hidden" name="key" value={provider?.key ?? ""} />}

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Identity</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="key"
              hint={isUpdate ? "Immutable. Products reference a provider by this key." : "Lower case, letters, digits and hyphens."}
            >
              Provider key
            </Label>
            <input
              id="key"
              name="key"
              required
              readOnly={isUpdate}
              defaultValue={provider?.key ?? ""}
              placeholder="my-esim-supplier"
              className={`${FIELD} ${isUpdate ? "opacity-60" : ""}`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="name">Display name</Label>
            <input
              id="name"
              name="name"
              required
              defaultValue={provider?.name ?? ""}
              placeholder="My eSIM Supplier"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="implementation"
              hint="Which code path serves this provider. generic-http is driven entirely by the mapping below."
            >
              Implementation
            </Label>
            <select
              id="implementation"
              name="implementation"
              defaultValue={provider?.implementation ?? "generic-http"}
              className={FIELD}
            >
              {IMPLEMENTATIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="mode" hint="Sandbox simulates delivery. Live contacts the supplier.">
              Mode
            </Label>
            <select id="mode" name="mode" defaultValue={provider?.mode ?? "sandbox"} className={FIELD}>
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label
              htmlFor="base_url"
              hint="https only. Required before a live provider can be enabled."
            >
              Base URL
            </Label>
            <input
              id="base_url"
              name="base_url"
              defaultValue={provider?.base_url ?? ""}
              placeholder="https://api.supplier.example/v1"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="notes">Operational notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={provider?.notes ?? ""}
              placeholder="Support contact, account manager, escalation route."
              className={FIELD}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Authentication</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="auth_scheme">Authentication scheme</Label>
            <select
              id="auth_scheme"
              name="auth_scheme"
              defaultValue={provider?.auth_scheme ?? "bearer"}
              className={FIELD}
            >
              {AUTH_SCHEMES.map((value) => (
                <option key={value} value={value}>
                  {AUTH_SCHEME_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="auth_header_name"
              hint="Only used by the API key header scheme. For example X-API-Key."
            >
              Custom header name
            </Label>
            <input
              id="auth_header_name"
              name="auth_header_name"
              defaultValue={provider?.auth_header_name ?? ""}
              placeholder="X-API-Key"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label
              htmlFor="credential"
              hint={
                hasStoredCredential
                  ? "A key is already stored. Leave this blank to keep it."
                  : "Encrypted before storage and never shown again."
              }
            >
              API key
            </Label>
            <input
              id="credential"
              name="credential"
              type="password"
              autoComplete="off"
              placeholder={hasStoredCredential ? maskHint(provider?.credential_hint) : "Paste the supplier API key"}
              className={`${FIELD} font-mono`}
            />
            {hasStoredCredential && (
              <span className="text-xs text-dim">
                Stored key currently ends{" "}
                <span className="font-mono text-ink">{maskHint(provider?.credential_hint)}</span>
                {provider?.credential_updated_at
                  ? ` - set ${provider.credential_updated_at.slice(0, 10)}`
                  : ""}
                . The full key cannot be displayed, because the server cannot read it back into
                this page: the ciphertext column is outside every client role&rsquo;s grants.
              </span>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Field mapping</legend>

        <p className="text-xs text-muted">
          This is the part a URL paste cannot cover. It tells the adapter what this supplier calls
          each field, where its response puts the cost and the delivery payload, and which of its
          status words mean delivered. The recognised keys are listed in the requirements panel.
          Leave it empty and the provider will validate but not fulfil.
        </p>

        <div className="flex flex-col gap-1">
          <Label htmlFor="request_mapping" hint="JSON object. Validated on save.">
            request_mapping
          </Label>
          <textarea
            id="request_mapping"
            name="request_mapping"
            rows={12}
            defaultValue={mappingJson}
            placeholder={`{
  "endpoints": {
    "quote": "/catalog/price",
    "fulfil": "/orders",
    "status": "/orders/{reference}"
  },
  "request": {
    "quantity": "qty",
    "reference": "external_ref",
    "productCode": "plan_code"
  },
  "response": {
    "cost": "data.pricing.unit_price",
    "status": "data.state",
    "payload": "data.profile",
    "errorCode": "error.code"
  },
  "status_map": { "DELIVERED": "completed", "PENDING": "pending" },
  "error_map": { "INSUFFICIENT_FUNDS": "fatal", "TIMEOUT": "retryable" }
}`}
            className={`${FIELD} font-mono text-xs`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="supported_lines" hint="Comma-separated product lines this provider can deliver.">
            Supported lines
          </Label>
          <input
            id="supported_lines"
            name="supported_lines"
            defaultValue={(provider?.supported_lines ?? ["esim"]).join(", ")}
            placeholder="esim, topup"
            className={FIELD}
          />
        </div>
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Delivery callbacks</legend>

        <p className="text-xs text-muted">
          Many suppliers do not push webhooks at all, in which case delivery has to be polled
          through the status endpoint above. Leaving this unset is correct for those suppliers -
          it is a fact to establish from their documentation, not a value to guess.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="webhook_path"
              hint="Our receiving path for this provider, if it pushes."
            >
              Webhook path
            </Label>
            <input
              id="webhook_path"
              name="webhook_path"
              defaultValue={provider?.webhook_path ?? ""}
              placeholder="my-esim-supplier"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="webhook_signature_scheme">Signature scheme</Label>
            <select
              id="webhook_signature_scheme"
              name="webhook_signature_scheme"
              defaultValue={provider?.webhook_signature_scheme ?? "none"}
              className={FIELD}
            >
              {WEBHOOK_SCHEMES.map((value) => (
                <option key={value} value={value}>
                  {WEBHOOK_SCHEME_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label
              htmlFor="webhook_secret"
              hint={
                hasStoredWebhookSecret
                  ? "A secret is already stored. Leave blank to keep it."
                  : "Encrypted before storage and never shown again."
              }
            >
              Webhook shared secret
            </Label>
            <input
              id="webhook_secret"
              name="webhook_secret"
              type="password"
              autoComplete="off"
              placeholder={hasStoredWebhookSecret ? "Stored - leave blank to keep" : "Paste the signing secret"}
              className={`${FIELD} font-mono`}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-3 p-5">
        <legend className="nuvora-label px-1">Availability</legend>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={provider?.is_active ?? false}
            className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-ink">Enabled</span>
            <span className="text-xs text-dim">
              An enabled live provider must have a base URL and an API key, and the database refuses
              to enable one that does not. Disabling is always safe and stops new orders being sent
              here.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          {submitLabel}
        </button>
        <span className="text-xs text-dim">
          Every field is re-validated on the server. No credential is ever sent back to the browser.
        </span>
      </div>
    </form>
  );
}

/** Error and notice banners for the provider pages. */
export function ProviderMessages({ error, notice }: { error?: string; notice?: string }) {
  const errorText = error ? (PROVIDER_ERRORS[error] ?? "The change was refused.") : "";

  const noticeText =
    notice === "created"
      ? "Provider created."
      : notice === "updated"
        ? "Provider saved. The stored credential was left unchanged unless a new key was entered."
        : notice === "enabled"
          ? "Provider enabled."
          : notice === "disabled"
            ? "Provider disabled. No further orders will be sent to it."
            : notice === "deleted"
              ? "Provider deleted."
              : "";

  return (
    <>
      {errorText && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {errorText}
        </p>
      )}
      {noticeText && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-muted"
        >
          {noticeText}
        </p>
      )}
    </>
  );
}
