import type { Metadata } from "next";

import { Card, Notice, PageHeader } from "@/components/admin/ui";
import {
  SETTING_COLUMNS,
  listSettings,
  settingToInputValue,
  type SettingRow,
} from "@/lib/admin/settings";
import { updateSettingsAction } from "@/lib/admin/settings-actions";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Settings" };

const FIELD =
  "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

const VALIDATION_MESSAGE =
  "One or more values could not be saved. Check each field: a number must be numeric, an email address must be valid, and a URL must start with http:// or https://. The submitted value is not echoed back here on purpose.";

/**
 * Business settings.
 *
 * THESE ARE DATABASE ROWS, NOT CONSTANTS. That is the whole point of the table: a support email
 * or a legal name that requires a redeploy to change is one that stays wrong for a week. Every
 * field here is read from `app_settings` and written back to it, and the form is generated from
 * the rows rather than from a hardcoded list, so a setting added by a future migration appears
 * here without this file being touched.
 *
 * SPLIT BY VISIBILITY, because `is_public` decides whether the value is readable by a visitor -
 * it is a security control, not a display preference. Showing the split on screen is what stops
 * somebody pasting a private operational figure into a public field.
 *
 * Public settings are editable here too, which is worth a warning rather than a disabled input:
 * the operator set the value, so they are the person who should be able to correct it.
 */
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  const { supabase } = await requireAdmin("/admin/settings");

  // RLS limits this to an admin automatically, which is why there is no filter on is_public.
  const settings = await listSettings(supabase);

  const publicSettings = settings.filter((setting) => setting.is_public);
  const privateSettings = settings.filter((setting) => !setting.is_public);

  return (
    <>
      <PageHeader
        label="Configuration"
        title="Business settings"
        description="Stored in the database and read at render time. A change here takes effect without a redeploy."
      />

      {error && <Notice tone="bad">{VALIDATION_MESSAGE}</Notice>}
      {notice === "saved" && <Notice tone="ok">Settings saved. Each change is recorded in the audit log.</Notice>}
      {notice === "unchanged" && <Notice>Nothing was changed, so nothing was written or logged.</Notice>}

      {settings.length === 0 && (
        <Notice tone="warn">
          No settings exist. They are created by a migration, never by a browser, so this means the
          settings migration has not been applied to this database.
        </Notice>
      )}

      {settings.length > 0 && (
        <form action={updateSettingsAction} className="flex flex-col gap-4">
          {publicSettings.length > 0 && (
            <Card
              title="Public settings"
              description="Readable by any visitor and used by the storefront and footer. Anything placed here is effectively published."
            >
              <div className="flex flex-col gap-4">
                {publicSettings.map((setting) => (
                  <SettingField key={setting.key} setting={setting} />
                ))}
              </div>
            </Card>
          )}

          {privateSettings.length > 0 && (
            <Card
              title="Private settings"
              description="Readable only by an administrator. Safe for internal thresholds and operational limits."
            >
              <div className="flex flex-col gap-4">
                {privateSettings.map((setting) => (
                  <SettingField key={setting.key} setting={setting} />
                ))}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
            >
              Save settings
            </button>
            <span className="text-xs text-dim">
              Unchanged fields are not written, so the audit log records decisions rather than
              every button press.
            </span>
          </div>
        </form>
      )}

      <Card title="How visibility is enforced">
        <p className="text-sm text-muted">
          The public/private split is enforced by Row Level Security, not by this page. A private
          setting is unreadable by any non-admin session even if a query asks for it directly -
          the verification harness asserts exactly that against a real database, rather than
          trusting this interface to hide it.
        </p>
      </Card>
    </>
  );
}

/**
 * One setting row.
 *
 * `type` follows the DECLARED value_type rather than being a free choice, so the browser's own
 * input validation agrees with the server's. The server still re-validates: an input type is a
 * convenience for the operator, never a control.
 */
function SettingField({ setting }: { setting: SettingRow }) {
  const value = settingToInputValue(setting.value, setting.value_type);

  const inputType =
    setting.value_type === "number"
      ? "number"
      : setting.value_type === "email"
        ? "email"
        : setting.value_type === "url"
          ? "url"
          : setting.value_type === "json"
            ? "text"
            : "text";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={setting.key} className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-ink">{setting.label}</span>
        <span className="font-mono text-[10px] text-dim">{setting.key}</span>
        <span className="font-mono text-[10px] text-muted">{setting.value_type}</span>
      </label>

      {setting.value_type === "json" ? (
        <textarea
          id={setting.key}
          name={setting.key}
          defaultValue={value}
          rows={4}
          spellCheck={false}
          className={`${FIELD} font-mono text-xs`}
        />
      ) : setting.value_type === "boolean" ? (
        // A checkbox submits nothing when unchecked, which parseSettingsForm treats as false for
        // this type only. An explicit hidden field would be simpler and would also mean an
        // absent field could not be distinguished from an unchecked box.
        <span className="flex items-center gap-2">
          <input
            id={setting.key}
            name={setting.key}
            type="checkbox"
            value="true"
            defaultChecked={value === "true"}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="text-xs text-muted">Enabled when ticked</span>
        </span>
      ) : (
        <input
          id={setting.key}
          name={setting.key}
          type={inputType}
          defaultValue={value}
          className={FIELD}
        />
      )}

      {setting.description && (
        <p className="text-xs text-dim">{setting.description}</p>
      )}
      {setting.is_public && (
        <p className="text-xs text-accent">
          Public. This value is served to visitors and appears in the footer.
        </p>
      )}
    </div>
  );
}
