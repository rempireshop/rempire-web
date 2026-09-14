# Moving the functions to Europe

*14.09.2026. A plan for one change: the region Vercel runs our functions in.
Nothing here has been executed. Everything measured is marked with the command
that measured it; everything estimated is marked **estimate**; everything only
the owner can see is in "Preconditions" at the end.*

---

## Short version

**The database does not move. Only the functions do.**

The database is already in Europe — Railway EU West Metal, Amsterdam
(`docs/accounts.md`, row «Railway»). The functions are in Washington, D.C.
(`iad1`), because `vercel.json` has never carried a `regions` key and `iad1` is
Vercel's default for new projects. So every database query the shop makes
crosses the Atlantic and comes back, and a route that makes several queries one
after another pays for that crossing several times over.

The whole change is three lines in `vercel.json` and a redeploy:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "crons": [ … unchanged … ]
}
```

There is no dump, no cutover window, no order-in-flight problem and no
rollback procedure, because nothing is being copied. Rolling back is deleting
the line and redeploying.

### A correction, so the earlier draft is not trusted

An earlier version of this document proposed moving the database to Europe as
well, with a maintenance window and a rollback plan. **That was wrong and
should be ignored.** It rested on timing `GET /api/testplan/` and concluding
that, since an uncached call took ~175 ms of which ~145 ms was the round trip
from Estonia, only ~30 ms was left for "the function and all its queries" —
which would be impossible if the queries were crossing the ocean, so the
database must be beside the function.

The route makes no queries. `src/app/api/testplan/route.ts` returns early for
anyone who is not signed in:

```ts
const signedIn = isAdmin(req);
if (!signedIn) {
  /* No database touched at all for a signed-out reader: the checklist is a
     file, and a phone with no session is exactly the case that has to keep
     working when the database does not. */
  return Response.json({ ok: true, plan: PLAN, signedIn: false, answers: {} }, { headers: NO_STORE });
}
```

`PLAN` is a statically imported constant from `src/lib/testplan.ts`. The ~30 ms
was a function doing no database work at all, so it said nothing about where the
database is. The corrected measurements are below, and they point the other way:
the database is far from the function, which is exactly the thing the move
fixes.

The lesson worth keeping: **never benchmark this shop with a route that can
skip the database.** Section 5 gives routes that cannot.

---

## 1. Confirming the diagnosis from the repository

### 1.1 Where the region is configured — nowhere

`vercel.json` in full, today:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/flows/",            "schedule": "0 7 * * *" },
    { "path": "/api/cron/events-retention/", "schedule": "30 3 * * *" }
  ]
}
```

No `regions` key. No `functions` block with a per-function override. Nothing in
`next.config.ts` sets a region, and no route file exports `preferredRegion`
(`grep -rn "preferredRegion" src` finds nothing). Vercel's documentation states
that functions default to `iad1` for all new projects, and the response headers
agree — every function response carries `x-vercel-id: arn1::iad1::…`, which
reads as "entered the network at Stockholm, executed in Washington".

The dashboard can also set a default region, and if it has been set there it
would not be visible in this repository. That is the first precondition in
section 6.

### 1.2 Which routes are `no-store`, and why

78 files under `src/` set `cache-control: no-store`; 85 route files exist in
total. Every route under `/api/admin/**` is in that set, and so is
`/api/account/**`, `/api/orders/`, `/api/overrides/hidden/` and both cron
routes.

This is deliberate and must not be undone. `src/app/api/overrides/hidden/route.ts`
carries the reasoning for the sharpest case:

> **Never cached.** The point of the middleware's question is that hiding a
> product takes effect without a deploy and without a wait (Dim, 08.09.2026:
> «if the item is hidden, it should be hidden without any deploys or
> rebuilds»), and every second of `s-maxage` here is a second in which the
> hidden product's page is still served.

So the admin never gets the edge-cached fast path, by design. It always pays
the full journey. That is the whole reason the region matters here more than it
would in a shop whose admin could be cached.

The public storefront is the opposite: `/api/overrides/` is
`public, s-maxage=30, stale-while-revalidate=120`, the catalogue is a committed
JavaScript file, and ~810 pages are prerendered to static files. Those are
already fast and the move does not change them.

### 1.3 The storefront is affected too — not just the admin

This was not in the original finding and is the largest single number in this
document.

`src/middleware.ts` runs on `/shop2/p/:id*` (and the `et`/`en` variants) and, on
**every product page view**, makes a same-origin request to
`/api/overrides/hidden/`, deliberately without caching it:

```ts
const res = await fetch(new URL("/api/overrides/hidden/", origin), {
  cache: "no-store",
  signal: AbortSignal.timeout(LOOKUP_MS),
});
```

That route runs exactly one query. So a product page — the most-visited page the
shop has, served from a static file with `x-vercel-cache: HIT` — is nevertheless
blocked on Stockholm → Washington → Amsterdam → Washington → Stockholm before a
single byte reaches the shopper.

Measured: a product page takes **305–453 ms** where a plain static asset on the
same host takes **41–61 ms**.

### 1.4 The measurements

Taken 14.09.2026 against `https://rempireshop.diipsolutions.eu`, eight samples
of each interleaved so that network drift affects all three equally, warm
(cold-start figures separately). `time_starttransfer` is time to first byte.

| what | route | queries | median TTFB |
|---|---|---|---|
| static file, served at the edge | `/shop2/styles.css` | — | **47 ms** |
| function, **zero** queries | `/api/testplan/` (signed out) | 0 | **182 ms** |
| function, **one** query | `/api/overrides/hidden/` | 1 | **268 ms** |
| the same, first call after idle | `/api/overrides/hidden/` | 1 | **879–954 ms** |
| product page (middleware + 1 query) | `/shop2/p/<id>/` | 1 | **305–453 ms** |

The static file's `x-vercel-id` is `arn1::…` with no second hop, so the 47 ms
*is* the round trip from the test machine to Stockholm. Subtracting down the
column gives the three legs directly:

| leg | cost | how it is derived |
|---|---|---|
| client ↔ Stockholm edge | **47 ms** | measured directly (static file) |
| Stockholm ↔ Washington | **135 ms** | 182 − 47 |
| Washington ↔ Amsterdam | **86 ms** | 268 − 182 |

The third row is the one that matters and the one the earlier draft got
backwards. **86 ms is an ocean.** A query to a database in the same region
costs 1–3 ms. This is the direct evidence that the database is not beside the
function, and it is consistent with `docs/accounts.md` having said Amsterdam all
along.

It is also consistent with the coordinator's own re-measurement from Estonia:
`GET /api/reviews/?product=…` at **1002 ms** on a cache MISS, 26–28 ms on a HIT.

### 1.5 How many uncached calls the admin's opening makes

Four HTTP requests, all fired in one breath, so **one client round trip**:

| request | server cost |
|---|---|
| `GET /api/assistant/` | 0 queries (environment check only) |
| `GET /api/admin/me/` | 0 queries — the admin session is a signed cookie, `src/lib/auth.ts:124` |
| `GET /api/admin/orders/` | 2–3 queries, **2 sequential waves** |
| `GET /api/admin/overview/` | 6–7 queries, **3 sequential waves** |

`public/shop2/app.js:27413` (`probeAdmin`) fires all four before awaiting
anything, and the comment there records that this was a deliberate change from
"three requests, two round trips" to one. The first screen is therefore bounded
by the deepest route, `/api/admin/overview/`, at three waves.

The three waves are worth naming because they are not obvious. `getOverviewSummary`
(`src/lib/analytics.ts:733`) looks like a flat `Promise.all` of five queries, but
one of its branches, `qOverviewLowStock`, calls `getOverrides` — which awaits
`product_overrides` and *then* `productStockStates` (`src/lib/inventory.ts:541`).
A serial pair hidden inside a parallel fan-out. A third wave appears when a
low-stock id belongs to an owner-created `c-…` product.

**Theoretical gain for the admin's first screen:** today
`182 + 3 × 86 = 440 ms` of pure network. From Frankfurt (section 2) the same
shape is ≈ `61 + 3 × 9 = 88 ms`. About **350 ms saved on every admin screen
open**, and the admin opens a lot of screens.

### 1.6 The route that gains the most is the checkout

`POST /api/orders/` has no `Promise.all` anywhere on its path. Every step is a
separate `await`:

| step | file |
|---|---|
| `product_overrides` (`priceItems` → `getOverrides`) | `orders.ts:806` |
| `stock_levels` (`productStockStates`) | `inventory.ts:547` |
| `settings` shipping rules (60 s module cache, so often free) | `shipping.ts:407` |
| `insert into orders` | `orders.ts:1300` |
| `update carts` (`markCartRecovered`) | `orders.ts:1345` |
| `select … settings where key='flows'` | `orders.ts:1379` |

That is **6 sequential round trips** for the simplest possible guest checkout.
A signed-in shopper with a promo code, points and the newsletter tick adds
`getCustomer`, `customerTier`, `getPricingSettings`, `codeDiscount`,
`quoteLoyaltyRedeem` — and `recordMarketingConsent`, which is a `withTx`
(`BEGIN` + insert + delete + `COMMIT` = four more round trips) running *after*
the order insert, fully on the shopper's critical path. Call it **~14 waves**.

At today's 86 ms that is **~1.2 seconds of pure Atlantic** inside a single
checkout POST. From Frankfurt it is ~0.13 s.

### 1.7 Is the measurement misread anywhere else?

Two corrections to how the numbers were originally framed, neither of which
changes the conclusion:

- **"About 145 ms of every uncached call is the Atlantic crossing."** Correct
  as far as it goes, but it is 145 ms *once* for the client leg, plus ~86 ms
  *per sequential database wave* on top. The original framing counted the ocean
  once; routes cross it two to fifteen times.
- **"first call after idle: up to 1219 ms, cold start."** Part of that is not
  cold start. `src/lib/db.ts` sets `idleTimeoutMillis: 10_000`, so a warm
  instance that has been quiet for eleven seconds has already dropped its
  Postgres connections. Opening a new one is TCP plus a TLS handshake — roughly
  three to four round trips — which at 86 ms each is ~300 ms *before* the first
  query runs. That portion is fixed by the move; the container-boot portion is
  not. Section 7.

---

## 2. Which European region

Vercel's European compute regions are Frankfurt (`fra1`), Paris (`cdg1`),
Dublin (`dub1`), London (`lhr1`) and Stockholm (`arn1`).

Railway has exactly **one** European region: EU West Metal, Amsterdam
(`europe-west4-drams3a`). There is no closer Railway option and no decision to
make on that side. The database stays where it is.

### The trade

The function sits between the shopper and the database:

```
shopper (Estonia) ──C──► Vercel region ──D──► Postgres (Amsterdam)
```

`C` is paid **once** per request. `D` is paid **once per sequential database
wave**. So the right region depends entirely on the wave count, and section 1
measured it:

| route | waves |
|---|---|
| `/api/admin/customers/`, `/api/reviews/`, `/api/account/me/`, `/api/overrides/hidden/` | 1 |
| `/api/admin/orders/`, `/api/admin/analytics/?range=7d` | 2 |
| `/api/admin/overview/` — the admin's first screen | 3 |
| `POST /api/orders/` — the checkout | 6 baseline, ~14 typical |
| `GET /api/cron/flows/` | up to ~100 per flow (per-row `update`s in a loop) |

`/api/account/me/` is the one genuinely well-tuned route in the set — six
queries in a single wave (`src/app/api/account/me/route.ts:47`), because each
helper fans out rather than awaiting. It is the shape the others should copy,
and it is also the shape that cares least which region we pick.

### The arithmetic

`C` for Stockholm is **measured**: 47 ms, the static-file number, because static
is served from `arn1`. The rest are **estimates** from distance (fibre round trip
is roughly 1 ms per 100 km of path, and real routing is close to double the
straight line). They must be re-measured after the move — section 5.

| region | C, client → region | D, region → Amsterdam |
|---|---|---|
| `arn1` Stockholm | **47 ms** (measured) | ~23 ms (estimate, ~1 130 km) |
| `fra1` Frankfurt | ~61 ms (estimate, +14 vs Stockholm) | ~9 ms (estimate, ~370 km) |
| `cdg1` Paris | ~70 ms (estimate) | ~11 ms (estimate, ~430 km) |
| `lhr1` London | ~70 ms (estimate) | ~9 ms (estimate, ~360 km) |
| `dub1` Dublin | ~80 ms (estimate) | ~20 ms (estimate, ~750 km) |
| `iad1` today | 182 ms (measured) | 86 ms (measured) |

Total at the shopper's browser, `C + waves × D`:

| waves | route | today `iad1` | `arn1` | `fra1` | winner |
|---|---|---|---|---|---|
| 1 | a product page, one review query | 268 ms | **70 ms** | 70 ms | tie |
| 2 | `/api/admin/orders/` | 354 ms | 93 ms | **79 ms** | `fra1` |
| 3 | `/api/admin/overview/` | 440 ms | 116 ms | **88 ms** | `fra1` |
| 6 | checkout, simplest case | 698 ms | 185 ms | **115 ms** | `fra1` |
| 14 | checkout, typical case | 1 386 ms | 369 ms | **187 ms** | `fra1` |

Break-even is at exactly one wave. At one wave the two are within a few
milliseconds and the choice does not matter; at two or more, Frankfurt wins, and
at the checkout it wins by ~180 ms.

### Recommendation: `fra1`, Frankfurt

1. **Every route that matters is two waves or more.** The admin's first screen is
   three, the checkout is six to fourteen, the nightly mail job is a hundred.
   The only routes where Stockholm would edge ahead are the one-wave routes,
   where the difference is a rounding error.
2. **It stays inside the EU.** London is the same distance from Amsterdam and
   would perform identically, but the shop stores customer names, addresses and
   e-mail. Keeping processing inside the EU avoids a conversation about the UK
   that Frankfurt simply does not start. Paris is the equivalent EU alternative
   and is a perfectly defensible second choice.
3. **Montonio gets closer too.** The payment provider is Estonian
   (`stargate.montonio.com`); the checkout calls it to create a payment link.
   That call crosses the Atlantic today and would not from Frankfurt.

Pick `arn1` instead only if the wave counts above are fixed in code first — if
the checkout and the overview are flattened to one or two waves each, the
balance tips back toward being nearest the customer.

### What the plan does **not** claim

- That `fra1` reduces cold starts. It does not — see section 7.
- Exact latency figures for any region other than Stockholm. Everything in the
  `C`/`D` table except the two measured rows is arithmetic from distance and
  must be confirmed by measuring, which is why section 5 is written the way it
  is.

---

## 3. The function move

### What changes

One key in `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "crons": [
    { "path": "/api/cron/flows/",            "schedule": "0 7 * * *" },
    { "path": "/api/cron/events-retention/", "schedule": "30 3 * * *" }
  ]
}
```

Vercel documents `regions` as an array, and the plan limits are: **Hobby — a
single region; Pro — five.** A single region that is not `iad1` is allowed on
Hobby; what Hobby forbids is *several* regions at once. `docs/HOSTING.md` §4
already flagged this ("Регион на Hobby менять можно… **проверить в панели
Vercel, какой стоит**"), and it is still the right reading.

No application code changes. Nothing else in the repository needs touching.

### The two cron jobs

Unaffected, and slightly safer afterwards.

- The `schedule` fields are UTC cron expressions and are independent of the
  execution region. `0 7 * * *` stays 07:00 UTC.
- Both routes authenticate with `Bearer <CRON_SECRET>` compared with
  `timingSafeEqual`. Nothing about that is regional.
- Both set `export const runtime = "nodejs"`, so both follow the project region
  like every other function.
- `/api/cron/flows/` sets `maxDuration = 60` with the comment that "the default
  10 s is not enough for a hundred round trips to Resend". It is also not
  currently enough for a hundred round trips to *Amsterdam*: `src/lib/flows.ts`
  updates rows one at a time inside a loop (`flows.ts:407`, `:826`, `:1016`), up
  to `BATCH` = 100 per flow. At 86 ms per update that is up to ~8.6 s per flow of
  network wait alone. At ~9 ms it is ~0.9 s. The job is closest to its timeout
  budget today and moves away from it.

**One caveat worth checking on the first night:** on Hobby, Vercel documents
that cron trigger times are approximate ("`0 1 * * *` … will trigger anywhere
between 1:00 am and 1:59 am"). That is a plan property, not a region property,
and it does not change either way.

### The edge cache

Unaffected. Vercel's CDN caches static content at the region nearest the
visitor, independently of where functions run. The ~810 prerendered pages, the
images and the fonts are already served from `arn1` at 41–61 ms and will
continue to be. `/api/overrides/` keeps its `s-maxage=30` and its HITs stay fast.

The one interaction to be aware of: **routing middleware is deployed to all
regions regardless of the `regions` setting** (Vercel documents this explicitly,
and notes Hobby runs it in fewer regions). So `src/middleware.ts` keeps running
near the shopper, and its uncached fetch to `/api/overrides/hidden/` will travel
Stockholm → Frankfurt instead of Stockholm → Washington. Product pages should
land around **80–90 ms** instead of 305–453 ms. *(estimate)*

### Anything that assumes a region or a host

Searched; there is nothing to fix.

- `grep -rn "iad1\|arn1\|fra1\|VERCEL_REGION\|rlwy\.net\|railway\.app" src tools`
  returns only two **comments**: `src/lib/db.ts:101`, describing the host-name
  exemption that was *removed* on 07.09.2026, and a note in
  `src/app/api/assistant/route.ts:447` about `*.vercel.app` origins. No live code
  branches on a host or a region.
- `src/lib/db.ts` builds its connection purely from `DATABASE_URL`,
  `DATABASE_SSL_CA` and `DATABASE_SSL_NO_VERIFY`. Region-agnostic.
- Absolute URLs are all outbound and unaffected: `PUBLIC_BASE_URL` (default
  `https://rempireshop.com`) in e-mail templates, and the third-party hosts.
  `src/middleware.ts` and `src/lib/payments/index.ts` build their own URLs from
  the incoming request's origin, so they follow the deployment wherever it is.
- Migrations are applied by `postbuild` → `node tools/migrate.mjs --if-configured`,
  which runs on the **build** machine, not in a function. The build region is
  Vercel's business and is unrelated to `regions`. Migrations are unaffected.

**Timeouts that would become generous rather than tight** — none needs changing,
all of them get more headroom:

| value | file | today | after |
|---|---|---|---|
| `LOOKUP_MS = 2500` (middleware's hidden lookup) | `middleware.ts:64` | ~270 ms used of 2500 | ~80 ms used |
| `connectionTimeoutMillis: 10_000` | `db.ts:157` | handshake ~300 ms | ~40 ms |
| `idleTimeoutMillis: 10_000` | `db.ts:156` | reconnect costs ~300 ms | ~40 ms |
| `maxDuration = 60` (cron flows) | `cron/flows/route.ts:25` | up to ~8.6 s of waits per flow | ~0.9 s |

### How to verify it worked

The evidence is `x-vercel-id`. Its shape is `<entry PoP/region>::<execution region>::<id>`:

```
today:  x-vercel-id: arn1::iad1::zf8h2-…     ← executed in Washington
after:  x-vercel-id: arn1::fra1::…            ← executed in Frankfurt
```

A static file shows only one segment (`arn1::…`) because nothing executed.

```bash
# The execution region. Must contain ::fra1:: after the deploy.
curl -sI https://rempireshop.diipsolutions.eu/api/overrides/hidden/ | grep -i x-vercel-id
```

Also confirm in the Vercel dashboard under **Settings → Functions → Function
Regions**, and on the deployment summary, which lists the region the build was
deployed to.

---

## 4. What is *not* happening

Recorded explicitly so nobody reinstates it from the earlier draft.

- **No `pg_dump`, no restore, no data copy.**
- **No maintenance window.** Orders can arrive throughout.
- **No "point of no return".** There is none in this plan. A region change is a
  configuration value applied at deploy time; the previous deployment still
  exists and Vercel's **Instant Rollback** restores it, or deleting the
  `regions` key and redeploying returns to `iad1`. Nothing is destroyed at any
  point, so nothing has to be recovered.
- **No risk to `order_number_seq`, `invoice_counters`, `gift_cards`/`gift_card_uses`,
  `loyalty_ledger` or `promo_code_uses`.** These are the tables a partial copy
  would have endangered — duplicate order numbers against the `orders.number`
  unique constraint, a reused invoice number against
  `orders_invoice_number_idx`, a gift-card balance spendable twice, points
  granted twice. Since nothing is copied, none of it applies. They are listed
  here only so that if a database move is ever proposed again, the dangerous
  set is already written down.

---

## 5. What to measure, before and after

Run this **before** the change and keep the output; run it again after. Same
machine, same network, same time of day.

### The rule

**Benchmark only with a route that cannot skip the database.** The earlier
draft's error was benchmarking `/api/testplan/`, which returns a constant to a
signed-out caller. Three routes that always query, need no authentication, and
are never edge-cached:

| route | queries | waves | what it isolates |
|---|---|---|---|
| `/api/overrides/hidden/` | 1 | 1 | one database round trip, cleanly |
| `/api/reviews/?product=system-4-bio-botanical-shampoo` | 2 | 1 | one wave, two queries |
| `/shop2/p/system-4-bio-botanical-shampoo/` | 1 | 1 | the real storefront path, through middleware |

Keep `/api/testplan/` in the set as the **zero-query control**: the gap between
it and `/api/overrides/hidden/` is the database round trip, and that single
number is the whole point of the exercise.

### The commands

```bash
HOST=https://rempireshop.diipsolutions.eu

# 1. Where does it execute? Expect arn1::iad1:: before, arn1::fra1:: after.
curl -sI $HOST/api/overrides/hidden/ | grep -i 'x-vercel-id'

# 2. The three legs. Eight interleaved samples so drift hits all three equally.
#    static = client<->edge; testplan = + client<->function; hidden = + one DB round trip.
for i in 1 2 3 4 5 6 7 8; do
  S=$(curl -s -o /dev/null -w '%{time_starttransfer}' $HOST/shop2/styles.css)
  T=$(curl -s -o /dev/null -w '%{time_starttransfer}' $HOST/api/testplan/)
  H=$(curl -s -o /dev/null -w '%{time_starttransfer}' $HOST/api/overrides/hidden/)
  echo "static=$S  fn_0q=$T  fn_1q=$H"
done

# 3. The real storefront page (middleware + one query), and a review read.
for i in 1 2 3 4; do
  curl -s -o /dev/null -w 'product=%{time_starttransfer}\n' \
    $HOST/shop2/p/system-4-bio-botanical-shampoo/
  curl -s -o /dev/null -w 'reviews=%{time_starttransfer}\n' \
    "$HOST/api/reviews/?product=system-4-bio-botanical-shampoo"
done

# 4. Cold start: leave it 15+ minutes untouched, then one call.
curl -s -o /dev/null -w 'cold=%{time_starttransfer}\n' $HOST/api/overrides/hidden/
```

Discard the first sample of any run — it pays TLS setup and probably a cold
start. Read the **median**, not the mean; one cold start skews a mean badly.

### The two numbers that decide whether it worked

```
client ↔ region      =  fn_0q  −  static
region ↔ Amsterdam   =  fn_1q  −  fn_0q      ← this is the one
```

| | before (measured 14.09) | after, target *(estimate)* |
|---|---|---|
| client ↔ region | 135 ms | ~15 ms |
| **region ↔ Amsterdam** | **86 ms** | **under 15 ms** |
| `/api/overrides/hidden/`, warm | 268 ms | ~70 ms |
| product page | 305–453 ms | ~80–90 ms |
| admin first screen (3 waves) | ~440 ms | ~90 ms |

If `region ↔ Amsterdam` does **not** drop below ~20 ms after the move, stop and
investigate before declaring victory. The likely cause is the fourth
precondition in section 6 — the connection going out through Railway's public
TCP proxy rather than staying inside Railway's network.

### For the admin, measured as Renat experiences it

Numbers above are curl. The thing the owner will judge is the panel opening on
his phone. Before and after, on the same phone and the same network: open the
admin, and in the browser's network panel read the time of `/api/admin/overview/`.
Expect roughly 440 ms → 90 ms. That is the number to report to him.

---

## 6. Preconditions — the things only the owner can check

None of these can be read from the repository. All should be confirmed **before**
the deploy.

1. **The database really is in Amsterdam.** Railway dashboard → project
   «rempire» → the Postgres service → region. It should read **EU West Metal
   (`europe-west4-drams3a`)**. `docs/accounts.md` says so and the 86 ms
   measurement is consistent with Washington↔Amsterdam, but the dashboard is the
   only proof. *If it turns out to be `us-east4` (Virginia), this entire plan
   inverts* — the database would be beside the functions and moving the
   functions alone would make things worse, not better.
2. **The Vercel project's current Function Region.** Settings → Functions →
   Function Regions. It may already have been changed in the dashboard, in which
   case the `x-vercel-id` evidence above is the truth and the dashboard needs
   reconciling. Note that a `regions` key in `vercel.json` takes effect for the
   deployment regardless of the dashboard value, so once the key exists the
   dashboard becomes decoration — worth setting both to the same thing to avoid
   confusing a future reader.
3. **Which plan the project is on.** Hobby permits exactly one region, and a
   single non-default region is fine. The deploy **fails before the build step**
   if more regions are requested than the plan allows — so put exactly one entry
   in the array.
4. **How `DATABASE_URL` reaches the database.** *Do not paste it anywhere —
   just look at the host part in the Railway/Vercel UI.* If it is Railway's
   public TCP proxy (`*.rlwy.net`), the connection leaves Railway's network and
   comes back, and some of the expected gain depends on where that proxy
   terminates. `docs/HOSTING.md` §7 already lists this as unverified ("Терминируется
   ли TLS на TCP-прокси Railway или проходит насквозь"). If Railway exposes a
   private/internal address usable from outside, it is not applicable to Vercel
   anyway — Vercel is not inside Railway's private network — so the realistic
   answer is: measure after the move and see whether `region ↔ Amsterdam` lands
   under 15 ms. If it lands at 40 ms, the proxy is the reason.
5. **If the project goes Pro: the regional price of `fra1` versus `iad1`.**
   Vercel prices some managed-infrastructure resources per region and publishes
   a per-region page for each. On Hobby the compute is free and this does not
   arise. Do not take a number from this document — read
   `vercel.com/docs/pricing/regional-pricing/fra1`.
6. **`DATABASE_SSL_CA`.** Unrelated to the region, but this is the natural
   moment. `docs/accounts.md` records it as not set, which means the certificate
   is currently either verified against the public trust store (and Railway
   signs its own, so it would fail) or unverified. The connection handshake is
   on the critical path being optimised, so fix it in the same sitting —
   `docs/backend.md`, "TLS to the database". **The owner exports and pastes this
   himself; it must not pass through anyone else.**

---

## 7. Order of operations

There is no point of no return in this plan, which is the main thing to
understand about it. Marked below anyway is the only step that changes what
customers see.

| # | step | reversible? |
|---|---|---|
| 1 | Confirm preconditions 1–3 in the dashboards. | — |
| 2 | Run the "before" measurements (section 5) and save the output into this file or a commit message. | — |
| 3 | Add `"regions": ["fra1"]` to `vercel.json` on a branch. Open a PR. Vercel builds a preview. | yes |
| 4 | Check the **preview** deployment's `x-vercel-id` — it should already read `::fra1::`. Run section 5 against the preview URL. | yes |
| 5 | ◀ **the only step customers see** ▶ Merge to `main`. Vercel builds and promotes to production. Expect the usual deploy, no downtime: the old deployment serves until the new one is ready. | yes — Instant Rollback |
| 6 | Confirm `x-vercel-id` on production reads `::fra1::`. | — |
| 7 | Run the "after" measurements. Compare the two derived legs. | — |
| 8 | Place one real test order end to end, and open every admin tab once. | — |
| 9 | Next morning: check that `/api/cron/flows/` ran at ~07:00 UTC and `/api/cron/events-retention/` at ~03:30 UTC. Vercel dashboard → Cron Jobs shows the last run and its status. On Hobby, logs live one hour — check in the morning, not at noon. | — |
| 10 | Update `docs/HOSTING.md` §6 item 1 ("Проверить регион функций — должен быть европейский") to say it is done, and record the before/after numbers. | — |

If anything is wrong at step 6, 7 or 8: **Instant Rollback** in the Vercel
dashboard restores the previous deployment immediately, or revert the commit.
There is no data to restore, because no data moved.

---

## 8. What this does **not** fix

Written plainly, because the change is small and the temptation to credit it
with more than it does will be real once the numbers improve.

### Cold starts — the biggest remaining number

Measured: the first call to `/api/overrides/hidden/` after an idle period took
**879–954 ms**, and the coordinator saw 1002 ms and one product page at 2258 ms.

Of that, roughly 300 ms is the Postgres connection handshake (TCP + TLS ≈ 3–4
round trips at 86 ms) and **that part does get fixed** — it becomes ~40 ms from
Frankfurt. The rest is the container booting and the Node bundle loading, and
the region has no effect on it whatsoever. Expect cold calls to stay somewhere
around **500–700 ms**. *(estimate)*

This matters more for this shop than for most, because **3–5 orders a month**
means the functions are idle almost all of the time, so a large share of real
visits pay a cold start. After the move, cold starts will be the dominant
remaining latency — and the graph will look worse than the warm numbers suggest.
Whoever reports the result should report both.

Addressing it is separate work: Vercel's Fluid compute (on by default for new
projects — worth checking whether this project has it), keeping the bundle
small, or accepting it. `src/lib/db.ts`'s `idleTimeoutMillis: 10_000` is also
worth revisiting — a longer idle timeout keeps the pool alive across a quiet
gap, at the cost of holding a connection open.

### Routes that are slow because of their shape, not their geography

The move divides every database round trip by about nine. It does not remove
any of them.

- **`POST /api/orders/` — ~14 sequential waves.** Still fourteen after the move.
  The clearest single fix is `recordMarketingConsent`: a four-round-trip
  transaction that runs *after* the order is already inserted, on the shopper's
  critical path, for a newsletter tick. It does not need to be there.
- **`/api/admin/overview/` — 3 waves where 2 would do.** The serial pair inside
  `getOverrides` (`product_overrides`, then `productStockStates`) can be one
  `Promise.all`.
- **`src/lib/flows.ts` — one `update` per row in a loop**, up to 100 per flow
  (`flows.ts:407`, `:826`, `:1016`). A single `update … where id = any($1)`
  would replace a hundred round trips with one.
- **`/api/admin/analytics/?range=7d` — 16 queries**, several of them
  `jsonb_array_elements` scans over every order ever placed. One wave, so
  latency is fine; the cost is database CPU and it grows with the order table.

These are all worth doing and none of them is this plan.

### Things that were already fast and stay exactly as they are

- Static files and the ~810 prerendered pages: 41–61 ms at the Stockholm edge.
- `/api/overrides/` on a cache HIT: 26–45 ms.
- The catalogue: a committed JavaScript file, no server involved.

### And one thing that gets slightly worse

`api.openai.com` is in the United States. The admin's AI text generation
(`/api/admin/ai/text/`) and the assistant will pay ~70–80 ms more per call from
Frankfurt than from Washington. Those calls already take several seconds, so it
is not perceptible — but it is real, and it is the one number that moves the
wrong way. Everything else outbound improves: Montonio is Estonian, Resend is
Ireland.

### Finally: the admin stays `no-store`, and should

Nothing here proposes caching admin responses. Stale admin data was itself a
reported bug and the `no-store` headers are the fix for it. The admin will
remain the part of the shop that always pays the full journey — which is
precisely why shortening that journey is worth doing.
