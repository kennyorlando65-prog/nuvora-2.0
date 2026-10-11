import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Settings reads.
 *
 * `app_settings.is_public` is the security control: a public row is readable by anyone so the
 * storefront and footer can render it, and a private row is admin-only. The read below goes
 * through the user-scoped client, so RLS is what enforces that - this module does not filter
 * in application code, because an application-side filter is one refactor away from being
 * forgotten.
 */

export type SettingRow = {
  key: string;
  value: unknown;
  value_type: string;
  label: string;
  description: string | null;
  is_public: boolean;
  updated_at: string;
};

export const SETTING_COLUMNS =
  "key, value, value_type, label, description, is_public, updated_at";

/** Every setting, for the admin page. RLS already limits this to an admin. */
export async function listSettings(supabase: SupabaseClient): Promise<SettingRow[]> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(SETTING_COLUMNS)
    .order("key", { ascending: true });

  if (error) throw new Error(`Settings read failed: ${error.message}`);

  return (data ?? []) as SettingRow[];
}

/** A single setting, or null. Used by the footer and storefront-facing copy. */
export async function getSetting(
  supabase: SupabaseClient,
  key: string,
): Promise<unknown | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) return null;
  return data?.value ?? null;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const URL_SHAPE = /^https?:\/\/[^\s]+$/;

export type SettingInput = { key: string; value: unknown; valueType: string };

export type SettingParseResult =
  | { ok: true; values: SettingInput[] }
  | { ok: false; error: string };

/**
 * Parses the settings form.
 *
 * The value is coerced to its DECLARED type before it is stored, so a setting declared as an
 * email cannot hold a phone number that merely looks plausible in a text box. Storing the
 * raw string and validating on read would put the failure at the point of use - the footer
 * rendering a broken link on a live page - rather than at the point of entry.
 *
 * A field absent from the submission is left untouched: the admin page only renders editable
 * fields, and a missing field is not an instruction to blank the value.
 */
export function parseSettingsForm(
  formData: FormData,
  declared: SettingRow[],
): SettingParseResult {
  const values: SettingInput[] = [];

  for (const setting of declared) {
    const raw = formData.get(setting.key);
    if (typeof raw !== "string") continue;

    const trimmed = raw.trim();

    switch (setting.value_type) {
      case "number": {
        if (trimmed === "") return { ok: false, error: `${setting.label} cannot be empty.` };
        const asNumber = Number(trimmed);
        if (!Number.isFinite(asNumber)) {
          return { ok: false, error: `${setting.label} must be a number.` };
        }
        values.push({ key: setting.key, value: asNumber, valueType: "number" });
        break;
      }

      case "boolean": {
        // An unchecked checkbox submits nothing, so absence means false for this type only.
        const asBoolean = trimmed === "true" || trimmed === "on";
        values.push({ key: setting.key, value: asBoolean, valueType: "boolean" });
        break;
      }

      case "email": {
        if (trimmed === "") return { ok: false, error: `${setting.label} cannot be empty.` };
        if (!EMAIL.test(trimmed)) {
          return { ok: false, error: `${setting.label} must be a valid email address.` };
        }
        values.push({ key: setting.key, value: trimmed, valueType: "email" });
        break;
      }

      case "url": {
        if (trimmed === "") return { ok: false, error: `${setting.label} cannot be empty.` };
        if (!URL_SHAPE.test(trimmed)) {
          return { ok: false, error: `${setting.label} must start with http:// or https://.` };
        }
        values.push({ key: setting.key, value: trimmed, valueType: "url" });
        break;
      }

      case "json": {
        try {
          values.push({ key: setting.key, value: JSON.parse(trimmed) as unknown, valueType: "json" });
        } catch {
          return { ok: false, error: `${setting.label} is not valid JSON.` };
        }
        break;
      }

      default: {
        if (trimmed === "") return { ok: false, error: `${setting.label} cannot be empty.` };
        values.push({ key: setting.key, value: trimmed, valueType: "string" });
      }
    }
  }

  return { ok: true, values };
}

/** Renders a stored value back into an input. Kept here so the page stays declarative. */
export function settingToInputValue(value: unknown, valueType: string): string {
  if (value === null || value === undefined) return "";
  if (valueType === "json") return JSON.stringify(value, null, 2);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
