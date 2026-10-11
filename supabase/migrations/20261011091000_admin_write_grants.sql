-- =============================================================================
-- NUVORA 2.0  |  20261011091000  |  Make the admin write policies reachable
--
-- A DEFECT IN 20261011090900, FOUND BY TRYING TO USE IT.
--
-- That migration created app_settings and user_moderation with RLS policies granting an admin
-- full access:
--
--   app_settings_admin_write        for update  to authenticated  using (is_admin())
--   user_moderation_admin_all       for all     to authenticated  using (is_admin())
--
-- and then granted `authenticated` SELECT only. A row level security policy can only ever
-- NARROW what a table or column grant already allows; it cannot widen it. With no UPDATE
-- grant, `app_settings_admin_write` was unreachable - an admin session could not change a
-- setting at all, and the policy was decoration. The Settings page would have failed with a
-- permission error while the policy sat there looking correct.
--
-- The lesson worth keeping: an RLS policy is not a permission. Both must be present, and
-- testing only the policy (as the earlier assertions did) proves nothing about whether a
-- permitted write can actually happen.
--
-- WHAT THIS GRANTS, AND NOTHING MORE
--   app_settings      UPDATE. Not INSERT (settings are created by a migration, never by a
--                     browser) and not DELETE (a setting is cleared, not removed, so the key
--                     keeps its label and audit history).
--   user_moderation   INSERT and UPDATE. INSERT is needed because the first suspension of an
--                     account has no row to update. DELETE is withheld deliberately: a
--                     moderation record is HISTORY, and clearing a suspension sets status back
--                     to 'active' with the row intact, so "was this account ever blocked, and
--                     why" survives. Deleting it would let an operator erase the reason.
--
-- WHAT AUTHORISES EACH WRITE IS STILL THE POLICY. These grants open the door; is_admin(),
-- evaluated against the verified JWT, is what decides who walks through it. The harness
-- asserts a non-admin is refused at both tables.
--
-- WHY suppliers WRITES ARE NOT GRANTED HERE. Supplier rows hold the encrypted credential and
-- the webhook secret, and they are written by application code that encrypts on the server.
-- A client session must never be able to write supplier rows, because the write path is where
-- the encryption happens: allowing a browser to write the ciphertext column directly would
-- mean the credential's protection depended on the browser behaving. Those writes go through
-- the service role, behind the admin gate, which is what lib/admin/provider-actions.ts does.
-- =============================================================================

grant update on table public.app_settings to authenticated;

grant insert, update on table public.user_moderation to authenticated;

-- The tables carry no sequences of their own; app_settings is keyed by text and
-- user_moderation by a foreign key, so there is nothing further to grant.
