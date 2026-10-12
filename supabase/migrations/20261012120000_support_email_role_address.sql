-- ---------------------------------------------------------------------------
-- 20261012120000_support_email_role_address
--
-- Replace the personal support mailbox with a role address.
--
-- WHY
--   The seed in 20261011090900_admin_rbac_and_providers.sql set
--   business.support_email to a PERSONAL mailbox. That row is is_public = true, so
--   it is served to anonymous visitors, and this repository is being published.
--   A personal address in a public repository is scraped and spammed permanently
--   and is attached to a real name. A role address is replaceable; a personal one
--   is not.
--
-- WHAT THIS DOES NOT DO
--   It does not rewrite git history. The personal address remains in the text of
--   the earlier migration and in this repository's history. That is accepted and is
--   stated in the handover report. Removing it from the current tree does not remove
--   it from history, which is precisely why the mailbox should be treated as already
--   public and monitored accordingly.
--
-- IDEMPOTENT
--   Safe to run more than once, and safe on a database where the row was already
--   changed by hand.
-- ---------------------------------------------------------------------------

update public.app_settings
   set value      = to_jsonb('support@nuvora.app'::text),
       updated_at = now()
 where key = 'business.support_email'
   and value is distinct from to_jsonb('support@nuvora.app'::text);

-- Refuse to report success while a personal address is still readable.
--
-- A silent no-op is the failure mode this file exists to prevent: the migration
-- would report success, the address would stay public, and nobody would know.
do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
    from public.app_settings
   where value::text ilike '%gmail.com%';

  if v_remaining > 0 then
    raise exception
      'a personal gmail address is still present in app_settings (% row(s)); refusing to report success',
      v_remaining;
  end if;
end $$;
