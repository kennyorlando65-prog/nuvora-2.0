-- =============================================================================
-- NUVORA 2.0  |  20261011090800  |  Fix the webhook_events processed-consistency check
--
-- A genuine bug in 20261011090400, found while wiring Stage 6 and settled only by
-- RUNNING assertions against real PostgreSQL - not by reasoning about the SQL. The
-- mistake turned out to be worse than it first looked, and the story is worth keeping.
--
-- THE ROW LIFECYCLE the constraint has to permit:
--
--   received  (processed_at null,     processing_error null)  <- inserted on arrival
--   success   (processed_at set,      processing_error null)
--   failed    (processed_at null,     processing_error set)
--   both      (both set)                                      <- contradictory
--
-- The second state is the whole point: marking an event processed is the LAST step of
-- the money-critical path, so a constraint that refuses it breaks every webhook.
--
-- WHAT THE ORIGINAL EXPRESSION ACTUALLY DID. Writing A for "processed_at is null" and B
-- for "processing_error is not null":
--
--   check ((processed_at is null) <> (processing_error is not null)
--          or (processed_at is null and processing_error is null))
--
--   success  -> A=false, B=false -> (false<>false) or false = FALSE   REFUSED (bug)
--   failed   -> A=true,  B=true  -> (true<>true)   or false = FALSE   REFUSED (bug)
--   received -> A=true,  B=false -> (true<>false)  or true  = TRUE    allowed
--   both     -> A=false, B=true  -> (false<>true)  or false = TRUE    allowed
--
-- It permitted precisely the two states that should be impossible and forbade the two
-- that actually occur. In production every webhook would have died at its final step.
--
-- THE SECOND ATTEMPT at the fix swapped the right-hand operand only:
--
--   check ((processed_at is not null) <> (processing_error is not null))
--
-- This is a correct XOR - but the XOR was never the right IDEA. It forces exactly one of
-- the two columns to be set, and therefore REFUSES the freshly received row that arrives
-- before any processing has happened. The verifier caught that immediately: the insert
-- that records an incoming webhook failed outright, which is the same class of outage as
-- the original bug with the opposite sign. A constraint can be individually consistent
-- and still describe a lifecycle that does not exist.
--
-- THE CORRECT RULE is simply "not both":
--
--   check (processed_at is null or processing_error is null)
--
--   received -> true   (allowed)
--   success  -> true   (allowed)
--   failed   -> true   (allowed)
--   both     -> false  (refused)
--
-- It matches the table's own comment - "an event is recorded on arrival; processed_at and
-- processing_error record the outcome" - which was right all along, and which is what
-- should have been read first.
--
-- NOTE ON VERSIONING: 20261011090400 was also corrected in place, in the same session and
-- before any database had applied it, so the history does not forward a known-broken
-- constraint to a fresh environment. This migration is the reconciliation for a database
-- that DID apply the original text: it renames the constraint first, because DROP-and-ADD
-- would otherwise create a window in which the rule is absent - and a webhook landing in
-- that window could write an impossible row that no version of the constraint would
-- later catch.
-- =============================================================================

-- Rename away first so the table is never left without the rule in force.
alter table public.webhook_events
  rename constraint webhook_events_processed_consistent
  to webhook_events_processed_consistent_old;

alter table public.webhook_events
  add constraint webhook_events_processed_consistent
  check (processed_at is null or processing_error is null);

alter table public.webhook_events
  drop constraint if exists webhook_events_processed_consistent_old;

comment on constraint webhook_events_processed_consistent on public.webhook_events is
  'An event may not be both processed and errored. A freshly received event has neither set, which is the state it is inserted in.';
