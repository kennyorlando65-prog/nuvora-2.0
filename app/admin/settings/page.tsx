import type { Metadata } from "next";

import { Card, Notice, PageHeader } from "@/components/admin/ui";
import { updateSettingsAction } from "@/lib/admin/settings-actions";
import { listSettings, settingToInputValue } from "@/lib/admin/settings";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings.
 *
 * WHAT THIS PAGE REPLACES. Until now the business name and support email existed only as
 * constants in the codebase, which meant correcting a typo in the support address required a
 * commit and a deploy. These values now live in `app_settings`, are editable here, and are
 * persisted to the database. The footer and legal copy read the same rows, so there is one
 * source of truth rather than a constant and a page that disagree.
 *
 * The field list is DRIVEN BY THE DATABASE, not hardcoded: `listSettings` returns whatever rows
 * exist, each carrying its own `value_type`, and the form renders an input appropriate to that
 * type. A setting added by a future migration therefore appears here automatically, provided its
 * type is one the renderer knows - and an unknown type falls back to a text input rather than
 * vanishing.
 *
 * `is_public` is shown but not editable. Publishing a setting to the storefront is a security
 * decision that belongs in a migration, where it is reviewed and versioned, not in a checkbox
 * somebody can flip from a browser.
 */

const FIELD = "nuvora-input";

const TYPE_LABELS: Record<string, string> = {
  string: "Text",
  email: "Email address",
  url: "URL",
  phone: "Phone number",
  number: "Number",
  boolean: "Yes or no",
  json: "JSON",
};

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  const { supabase } = await requireAdmin("/admin/settings");
  const settings = await listSettings(supabase);

  return (
    <>
      <PageHeader
        label="Configuration"
        title="Settings"
        description="Editable business configuration, stored in the database and applied across the storefront, receipts and legal copy. Every change is recorded in the audit log with its previous value."
      />

      {error === "validation" && (
        <Notice tone="bad">
          One or more values could not be saved. Each field is checked against the type the
          database declares for it - an email address must be an address, a number must be a
          number, and a URL must start with http:// or https://.
        </Notice>
      )}

      {notice === "saved" && <Notice tone="ok">Settings saved.</Notice>}
      {notice === "unchanged" && <Notice tone="neutral">Nothing had changed, so nothing was written.</Notice>}

      {settings.length === 0 ? (
        <Notice tone="warn">
          No settings rows exist. That is unexpected, because the migration that creates this
          table also seeds the business fields. Check that all migrations have been applied.
        </Notice>
      ) : (
        <form action={updateSettingsAction} className="flex flex-col gap-4">
          <Card
            title="Business details"
            description="These appear in the storefront footer and in receipt and legal copy. Support email is where customer replies are directed."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {settings.map((setting) => (
                <div
                  key={setting.key}
                  className={`flex flex-col gap-1 ${setting.value_type === "json" ? "sm:col-span-2" : ""}`}
                >
                  <label htmlFor={setting.key} className="flex flex-col gap-0.5">
                    <span className="nuvora-label">{setting.label}</span>
                    <span className="font-mono text-[10px] text-dim">{setting.key}</span>
                  </label>

                  {setting.value_type === "boolean" ? (
                    <select
                      id={setting.key}
                      name={setting.key}
                      defaultValue={String(setting.value)}
                      className={FIELD}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : setting.value_type === "json" ? (
                    <textarea
                      id={setting.key}
                      name={setting.key}
                      rows={5}
                      defaultValue={settingToInputValue(setting.value, setting.value_type)}
                      className={`${FIELD} font-mono text-xs`}
                    />
                  ) : (
                    <input
                      id={setting.key}
                      name={setting.key}
                      type={setting.value_type === "number" ? "number" : "text"}
                      defaultValue={settingToInputValue(setting.value, setting.value_type)}
                      className={FIELD}
                    />
                  )}

                  <span className="text-xs text-dim">
                    {setting.description ?? "No description."}{" "}
                    <span className="text-dim">
                      Type: {TYPE_LABELS[setting.value_type] ?? setting.value_type}.{" "}
                      {setting.is_public
                        ? "Public - readable by the storefront."
                        : "Private - readable by administrators only."}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="nuvora-btn nuvora-btn-primary"
            >
              Save settings
            </button>
            <span className="text-xs text-dim">
              An unchanged value is not rewritten and does not produce an audit entry, so the
              trail records decisions rather than button presses.
            </span>
          </div>
        </form>
      )}

      <Card title="What is deliberately not editable here">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
          <li>
            <strong className="text-ink">Whether a setting is public.</strong> That is a security
            decision, and it is made in a migration where it is reviewed and versioned. A
            dropdown here would let a private operational value be published to the storefront by
            accident.
          </li>
          <li>
            <strong className="text-ink">Margin and pricing rules.</strong> Those are separate
            rows with their own constraints, and a free-text field would let a rule be saved that
            cannot produce a valid price. They need their own screen, which is outstanding.
          </li>
          <li>
            <strong className="text-ink">Gateway credentials.</strong> Paystack and Flutterwave
            keys live in Vercel environment variables, never in the database, because they are
            process configuration rather than operator data.
          </li>
          <li>
            <strong className="text-ink">Supplier API keys.</strong> Those are on the providers
            page, encrypted at rest, and never displayed once saved.
          </li>
        </ul>
      </Card>

      <Notice tone="warn">
        The legal and policy text these settings feed is drafting material. It requires review by
        a qualified Nigerian lawyer, with an EU or UK adviser for GDPR, before launch.
      </Notice>
    </>
  );
}
