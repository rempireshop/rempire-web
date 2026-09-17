-- 191_login_ladder_index.sql — make "how many failed logins since T" cheap
--
-- The failed-login delay (src/lib/auth.ts, «failed-login backoff») counted
-- misses in a Map inside one serverless instance. A cold start emptied it, so
-- the guesser it was built to slow down got a fresh ladder for free — the very
-- weakness the delay was meant to close. Dim, 17.09.2026: move the counter
-- into the database.
--
-- It costs NO new table and NO new write. Every refused password already
-- writes one row here — writeAuditSafe("ip:…", "admin.login.failed") in
-- src/app/api/admin/login/route.ts — and every accepted one writes
-- "admin.login" beside it. The ladder is those rows counted: failures since
-- the later of (the last success) and (an hour ago). The counter was in the
-- table the whole time; nothing was reading it.
--
-- WHAT WAS MISSING IS THE INDEX. admin_audit carried exactly one
-- (001_core.sql):
--
--   admin_audit_at_idx on admin_audit (at desc)
--
-- — which serves «the last hundred things that happened», the audit screen's
-- only question until now. Ours is different in a way that matters: «when did
-- action X last happen». Answered through an index on `at` alone that is a
-- backwards walk over every audit row written since, re-reading the heap for
-- each one to look at `action`. For the failure count that walk is bounded by
-- the hour window and stays small. For the LAST SUCCESSFUL LOGIN it is not
-- bounded by anything: the owner signs in about once a day and does a few
-- hundred other audited things in between, so the scan is short while he is
-- around and grows without limit while he is away — a fortnight's holiday is
-- exactly when a guesser would like the login path to get slower with every
-- row the shop writes.
--
-- PARTIAL, on purpose. A plain (action, at desc) would answer the same two
-- questions and put an index entry on every audit row the shop ever writes —
-- every price edit, every status change, every letter — to serve two of them.
-- These two indexes hold login rows only: a handful a day, and the other 99 %
-- of audit writes pay nothing at all for them. That keeps the promise this
-- change was chosen on — a durable ladder for one SELECT and no extra write
-- — as nearly true as an index allows. The honest remainder: an accepted or
-- refused login now maintains one b-tree entry it did not before.
--
-- The predicates are plain equality against the two action names, so Postgres
-- can prove a query's `action = 'admin.login.failed'` implies the index's own
-- condition without any help; one combined `action in (…)` index would rest on
-- the planner's array proof for the same storage.
--
-- NO TIMEZONE HERE, and that is not an oversight. The repo's rule is that days
-- and times are Tallinn (src/lib/day.ts) because a calendar day cut in the
-- database's timezone is a different day in Tallinn. This window is not a
-- calendar day: it is «an hour of elapsed time», and both sides of the
-- comparison are timestamptz, which is an instant and the same instant
-- everywhere. Converting it to Tallinn would change nothing and add a way to
-- be wrong.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

-- the ladder itself: failures inside the window
create index if not exists admin_audit_login_failed_at_idx
  on admin_audit (at desc)
  where action = 'admin.login.failed';

-- what resets it: the owner's last accepted password
create index if not exists admin_audit_login_ok_at_idx
  on admin_audit (at desc)
  where action = 'admin.login';
