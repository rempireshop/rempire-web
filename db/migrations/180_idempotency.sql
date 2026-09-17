-- 180_idempotency.sql — «сделать один раз» (migration range 180–189)
--
-- One answer to twelve findings of the September audit, all of them the same
-- defect: a POST that CREATES something has no memory of having run, so when
-- the answer is lost on the way back the retry creates a second of whatever
-- the first one created. The answer is lost far more often than it sounds —
-- a phone that changes cell between the tap and the reply, an edge 502, and
-- most of all a person who taps «Оформить заказ» again because nothing has
-- happened yet. What that costs, route by route:
--
--   POST /api/orders                  a second order, and for «По счёту» a
--                                     second invoice with a real number sent
--                                     to a real customer;
--   POST /api/admin/pos-orders        the cashier rings the same sale twice;
--   POST /api/admin/inventory/moves   a retried «+1 приход» counts one bottle
--                                     twice (see FINGERPRINT below — this is
--                                     the case that decides the whole shape);
--   adjustLoyaltyPoints               a second manual credit;
--   a new article, a review, «Сохранить товар»  a duplicate of each.
--
-- The shop cannot fix this by looking at what was sent. Two «+1 приход» in a
-- row are two real bottles and must both count; two taps on one «+1 приход»
-- are one bottle. Nothing in the request tells them apart. Only the CLIENT
-- knows, because only the client knows whether this is a new intention or a
-- repeat of the last one — so the client mints a key per intention and sends
-- it with the request, and this table is where the shop remembers it.
--
-- THE PRIMARY KEY is the key alone, not (key, route).
--
-- The key means «this one thing the person meant to do», not «this one thing
-- on this one path». A key is a random uuid the client mints per action, so
-- the same key arriving at a different route is never a legitimate event: it
-- is a crossed wire — a client that reuses one key for the whole basket, a
-- copied fetch() that kept its neighbour's header. With (key, route) as the
-- key that bug is invisible for ever and each route quietly gets its own
-- slot; with the key alone the route is stored beside it and the mismatch
-- can be refused out loud (src/lib/idempotency.ts, outcome `mismatch`). One
-- index, one lookup, and one predicate for the sweep at the bottom.
--
-- THE SAME KEY WHILE THE FIRST REQUEST IS STILL RUNNING is the case that
-- actually happens: two taps two seconds apart, and creating an order takes
-- longer than that. A row is therefore inserted at the START, state
-- 'running', with `insert … on conflict (key) do nothing` — and that insert
-- is its own statement, committed on its own, NOT part of the transaction
-- that does the work.
--
-- That separation is the whole design, and the alternative is worse in a way
-- that is easy to miss. If the reservation lived inside the work's own
-- transaction, the second request would not be told anything: it would BLOCK
-- on this table's unique index until the first transaction committed, holding
-- a serverless function and a database connection for the entire length of an
-- order (which talks to Montonio, writes an invoice and sends a letter). On a
-- platform that kills a function at its budget, that second request is a
-- spinner that ends in an error for an order that actually succeeded. With
-- the reservation committed on its own, the second request learns in one round
-- trip that the first is in flight and can say so immediately.
--
-- (It is also the only shape the test suite can prove. PGlite is one
-- connection: a query issued outside a transaction waits for the transaction,
-- which is waiting for the query — src/lib/newsletters.ts claim() ran into
-- exactly this. A reservation that is already committed leaves nothing open,
-- so tests/idempotency.test.ts can hold the first call's work suspended and
-- let the second call ask its question.)
--
-- THE LEASE. A function killed mid-flight leaves a 'running' row that nothing
-- will ever finish, and without a way out that key is wedged for good — the
-- shopper taps again and is told for ever that a request is in progress. The
-- same problem, and the same answer, as `newsletters.sending_at`
-- (160_newsletters.sql): a 'running' row older than the lease belongs to
-- nobody and the next caller takes it over. 90 seconds — longer than the
-- longest budget any route in this shop asks for (`maxDuration = 60`), so a
-- slow-but-alive request is never stolen from, and short enough that a wedged
-- key clears while the person is still on the page.
--
-- WHAT IS STORED, AND WHAT IS NOT. A finished row carries the status code and
-- the body that were sent the first time, and a replay answers with exactly
-- those — the client is going to treat the replay as the real answer, so
-- «201 and the order number» must come back as «201 and the order number»,
-- not as a 200 saying the work was skipped.
--
-- A request that FAILED stores nothing: the row is released and the key can be
-- used again. There is no second order to protect against if the first one was
-- never created, and pinning the failure would be actively harmful — a shopper
-- whose address was refused fixes it, submits again, and would be handed the
-- old complaint about the old address for as long as the row lived.
--
-- FINGERPRINT is a guard, not a dedupe, and the difference is finding 3 above.
-- Deduping by CONTENT would break the warehouse: two identical «+1 приход»
-- bodies are two real bottles. This column is the opposite direction — the
-- same KEY must carry the same body. Two different keys with identical bodies
-- are two rows and both run, which is the behaviour the warehouse needs; one
-- key with two different bodies is a client that lost track of itself, and it
-- is refused rather than answered with somebody else's result. It is also what
-- makes a guessed key useless: the reply is only handed back to a caller who
-- can reproduce the request that earned it. Nullable — a route that does not
-- pass one is simply not checked, and the column stores a sha-256, never the
-- body itself (an order body is a name, an address and a phone number, and
-- there is no reason for a second copy of those to sit here for two days).
--
-- RETENTION is 48 hours. A retry that arrives a day after the tap is not a
-- retry of anything; what is left is a table that grows for ever. Cleanup
-- follows `events` (080_events.sql): a sweep from inside the code that writes
-- here, on a fraction of the calls, so nothing depends on a schedule being
-- wired up. The odds are not the 1-in-2000 the analytics beacon uses — this
-- shop takes a handful of orders a day, not a thousand page views an hour, and
-- one in two thousand would fire about once a year. See
-- src/lib/idempotency.ts sweepIdempotencyKeys().
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists idempotency_keys (
  -- The client's key. Bounded here as well as in the helper: this is a value
  -- from a request header, and a header is whatever the caller felt like
  -- sending. The lower bound keeps a client bug («1», «retry») from claiming
  -- a name another shopper could collide with by accident.
  key         text primary key check (length(key) between 8 and 200),
  -- Which route claimed it, e.g. 'POST /api/orders'. Never used to look a row
  -- up — only to catch one key being used for two different things.
  route       text not null,
  state       text not null default 'running' check (state in ('running', 'done')),
  -- When this attempt started. Doubles as the lease clock and as what the
  -- retention sweep reads.
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- The answer that was sent the first time. Both null while running.
  status      int check (status is null or (status between 100 and 599)),
  response    jsonb,
  -- sha-256 of the request body, hex. Null when the route does not pass one.
  fingerprint text
);

-- A finished row that cannot answer is worse than no row: the second tap
-- would be told «this already ran» and handed nothing. The state and the
-- answer are therefore one fact, not two.
alter table idempotency_keys drop constraint if exists idempotency_keys_answer_ck;
alter table idempotency_keys add constraint idempotency_keys_answer_ck check (
  (state = 'running' and status is null and response is null and finished_at is null)
  or (state = 'done' and status is not null and response is not null and finished_at is not null)
);

-- The retention sweep's one question: which rows are older than two days.
create index if not exists idempotency_keys_started_idx on idempotency_keys (started_at);
