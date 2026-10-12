"use client";

import { useId, useState } from "react";

/**
 * Password input with a show/hide toggle.
 *
 * WHY THIS IS A CLIENT COMPONENT AND NOT A LINE IN EACH PAGE.
 * app/auth/sign-in/page.tsx, app/auth/sign-up/page.tsx and app/auth/update-password/page.tsx
 * are React Server Components. A server component cannot hold state and cannot run a click
 * handler, so a toggle written inline in any of them would either do nothing at all or force
 * the whole page to become client-side - which would pull the server session read and the
 * server-side error mapping into the browser bundle. This is the smallest piece that
 * genuinely needs interactivity, so it is the only piece that ships as a client component.
 *
 * WHAT THE TOGGLE DELIBERATELY DOES NOT DO: it does not change how the password travels. It
 * flips the input's `type` between "password" and "text" and nothing else. The value is
 * submitted by the same form action over the same HTTPS connection either way, and React
 * updates the attribute in place, so an already-typed value survives the toggle.
 *
 * ACCESSIBILITY, and each point is a deliberate decision rather than a default:
 *
 *   - The toggle is a real <button type="button">. It is therefore focusable and operable
 *     from a keyboard with no extra work, and type="button" stops it submitting the form it
 *     sits inside - which a bare <button> would do, since a form has exactly one implicit
 *     submit.
 *   - aria-pressed carries the on/off state, so a screen reader announces it as a toggle
 *     whose state can be read, rather than as an action of unknown effect.
 *   - The accessible name CONTAINS the visible text ("Show"/"Hide"). WCAG's label-in-name
 *     rule requires that of a control whose visible label changes: a name of "Toggle
 *     password visibility" that omits the word the user can see is a mismatch between what
 *     is spoken and what is on screen.
 *   - The hint ("At least 8 characters") is wired through aria-describedby, so it is
 *     announced as a requirement OF THIS FIELD. As a loose paragraph it was previously
 *     announced when the reader reached it in document order - which is after the field it
 *     describes, at which point the user has already typed.
 *   - aria-invalid marks a field that failed validation, so an error is not communicated by
 *     colour alone. The message itself stays in the page-level alert, which already carries
 *     role="alert"; duplicating it here would make a screen reader read it twice.
 */
export function PasswordField({
  name,
  label,
  autoComplete,
  minLength = 8,
  required = true,
  hint,
  invalid = false,
}: {
  name: string;
  label: string;
  /** "current-password" when signing in, "new-password" when setting one. */
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
  /** Presented as a description of this field, not as loose page copy. */
  hint?: string;
  /** True when this field is implicated in the failure that brought the user back. */
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="nuvora-label">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          className={`nuvora-input pr-20 ${invalid ? "nuvora-input-invalid" : ""}`}
        />

        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          aria-controls={id}
          className="nuvora-password-toggle"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {hint && (
        <p id={hintId} className="text-[11px] text-dim">
          {hint}
        </p>
      )}
    </div>
  );
}
