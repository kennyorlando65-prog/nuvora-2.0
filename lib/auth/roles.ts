/**
 * Role resolution.
 *
 * Admin is read from `app_metadata`, NEVER from `user_metadata`. This distinction is the
 * whole security model of the admin area and it is worth stating plainly:
 *
 *   user_metadata      is writable BY THE USER through the Supabase client. A signed-in
 *                      customer can set `user_metadata.nuvora_role = 'admin'` on
 *                      themselves with one API call. Any check reading it is decoration.
 *   app_metadata       is writable only by the service role or the Supabase dashboard.
 *                      A client cannot alter it, so it is the only safe place to record a
 *                      privilege.
 *
 * The database enforces the same rule independently in `public.is_admin()`, which reads the
 * `app_metadata.nuvora_role` claim out of the verified JWT. This module exists so the
 * application layer agrees with the database rather than inventing a second opinion.
 */

export type RoleBearingUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

export const ADMIN_ROLE = "admin";

/** The role recorded on a user, or null when none is set. */
export function roleOf(user: RoleBearingUser | null | undefined): string | null {
  const raw = user?.app_metadata?.nuvora_role;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * True only for a user whose app_metadata role is exactly "admin".
 *
 * Deliberately not `role.includes("admin")` or a case-insensitive match: a role of
 * "not-an-admin" or "Admin" should not silently grant the admin area, and an exact
 * comparison is the behaviour the database already applies.
 */
export function isAdminUser(user: RoleBearingUser | null | undefined): boolean {
  return roleOf(user) === ADMIN_ROLE;
}

/** Human-readable label for the "signed in as" indicator. */
export function displayIdentity(user: RoleBearingUser): string {
  return user.email ?? user.id;
}
