#!/usr/bin/env node
/**
 * go-live-reset.mjs — take the test data out of the shop's database, once,
 * on the morning it goes live.
 *
 * The shop has been staging against the SAME database it will serve real
 * orders from. Months of test orders, test customers, test refunds, fake
 * reviews and a test newsletter blast are in there, next to everything Renat
 * spent weeks writing: prices, delivery tariffs, letter texts, blog articles,
 * promo codes, the contact page. «Clean up the tests» by hand, at 09:00, with
 * the owner waiting, against the only copy, is how shops die. This is that job
 * written down instead.
 *
 *   node tools/go-live-reset.mjs                 # DRY RUN — prints, changes nothing
 *   node tools/go-live-reset.mjs --clear --confirm "…"   # the real thing
 *
 * Read docs/go-live-reset.md before running it. Its first instruction is to
 * take a Railway snapshot and check that the snapshot exists, because nothing
 * here is undoable and a rollback is a restore.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS FILE IS BUILT ON
 * ---------------------------------------------------------------------------
 *
 * 1. EVERY TABLE IS NAMED, AND EVERY VERDICT IS ARGUED. PLAN below has one
 *    entry per table in db/migrations/, with the reason in prose beside it. A
 *    table the schema has and PLAN does not is a REFUSAL, not a default —
 *    see assertSchemaKnown(). Someone will add a migration after this file was
 *    written; the tool must not guess what it is for.
 *
 * 2. NO `TRUNCATE … CASCADE`, EVER. Cascade follows foreign keys into tables
 *    that are not on the clear list — `gift_card_uses` hangs off `gift_cards`,
 *    `loyalty_ledger` off `customers`, `newsletter_sends` off `newsletters`,
 *    and `newsletters` is a KEEP table. Every delete here is a plain `delete
 *    from <one table>`, children before parents, in the order DELETE_ORDER
 *    spells out.
 *
 * 3. THE WHOLE CLEAR IS ONE TRANSACTION, AND IT PROVES ITSELF BEFORE IT
 *    COMMITS. Row counts and a per-table md5 fingerprint are taken before;
 *    the same are taken after, inside the transaction; if one row of one KEEP
 *    table moved, the transaction is rolled back and the tool exits non-zero.
 *    A reset that quietly takes the settings with it must fail loudly on the
 *    morning, not be discovered on Monday.
 *
 * 4. WHERE THE SCHEMA CANNOT DECIDE, THE TOOL DOES NOT EITHER. It prints what
 *    it found, and asks for a flag. `--stock` is the whole of that today.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THAT MATTER MOST
 * ---------------------------------------------------------------------------
 *
 * `mail_optouts` IS NEVER CLEARED. Not by default, not behind a flag, not with
 * --force. A stop list is not test data: every row is somebody who pressed
 * «Отписаться», and deleting the row silently puts them back on the list the
 * next mailing reads (src/lib/newsletters.ts audienceRows). That is precisely
 * the harm 052_marketing_consent.sql and this month's work exist to prevent.
 * The address is kept even though the customer row it belonged to is deleted —
 * that asymmetry is deliberate and is the point: consent may be lost safely,
 * a refusal may not.
 *
 * `admin_audit` IS NEVER CLEARED EITHER, and «clean» does not mean «empty»
 * here. Two reasons, either one sufficient. It is the record of who did what,
 * which is not test data at any age. And 192_login_ladder_index.sql moved the
 * failed-login backoff INTO this table: the delay a password guesser gets is
 * «failures since the later of (the last success) and (an hour ago)», counted
 * off these rows. Emptying it hands whoever is mid-ladder a fresh start, at
 * 09:00 on the day the shop first appears in public. At 3–5 orders a month the
 * table is a few thousand rows; there is nothing to save by deleting it.
 */
import { pathToFileURL } from "node:url";
import { migrate, sslFor } from "./migrate.mjs";

/* ---------- the plan ----------------------------------------------------- */

/**
 * One entry per table `db/migrations/*.sql` creates, plus `_migrations`.
 *
 * verdict:
 *   "clear" — test data, deleted by --clear
 *   "keep"  — the shop itself, or a record; never deleted
 *   "ask"   — the schema cannot decide; a named flag does
 * never:
 *   true    — no flag, no argument, no exception. Three tables.
 */
export const PLAN = [
  /* ---- the shop: everything Renat typed, and everything a migration seeded */
  {
    table: "settings",
    verdict: "keep",
    why:
      "The shop's own switches and documents in one place: shipping_rules (the tariff table), pricing " +
      "(wholesale and loyalty), delivery, mail_texts (his subject lines and signatures in three languages), " +
      "payment_banks, gift_amounts, flows, content, home. Weeks of work, none of it an order. The table is " +
      "kept whole; two rows are named exceptions, deleted by key — `flow_runs` always (SETTINGS_CLEAR_KEYS) " +
      "and `testplan_answers` only with --testplan (SETTINGS_ASK_KEYS). Both are argued where they are listed.",
  },
  {
    table: "product_overrides",
    verdict: "keep",
    why:
      "Per-product edits the owner made in the admin: price, the manual in/low/out badge, SEO title and " +
      "description, subcategory, variant photos, video. The catalogue in src/data is the base; this table " +
      "is what he changed about it. Deleting it silently reverts every price edit he has made.",
  },
  {
    table: "custom_products",
    verdict: "keep",
    why: "Products that exist only here, not in the Shopify-derived catalogue. He typed them; they are stock, not tests.",
  },
  {
    table: "bundles",
    verdict: "keep",
    why:
      "Set definitions (name and description in three languages, contents, price or discount). Seeded by " +
      "120_bundles.sql and edited in the admin since. Catalogue, not orders.",
  },
  {
    table: "posts",
    verdict: "keep",
    why:
      "Blog articles, drafts and published alike, in three languages with covers and SEO. 071_blog_samples.sql " +
      "seeded some and he has been rewriting them since; nothing here distinguishes a seeded post from one he " +
      "wrote, and it must not — both are the shop's content.",
  },
  {
    table: "promo_codes",
    verdict: "keep",
    why:
      "Promo code DEFINITIONS — the code, the percent, the floor, the dates, the cap. These are marketing he " +
      "set up, not something a test order created. The `used` counter on them is a different matter: it counts " +
      "rows in promo_code_uses, which this tool empties, so it is reset to 0 in the same transaction. A code " +
      "with max_uses = 10 that was tested ten times would otherwise be dead on launch morning.",
  },
  {
    table: "newsletters",
    verdict: "keep",
    why:
      "The letters themselves — his title, subject and body in three languages and the product cards under " +
      "them. Kept, because he wrote them. But the SEND STATE on them is cleared in the same transaction: a " +
      "letter with status='sent' is frozen for good (src/lib/newsletters.ts refuses to edit, delete or re-send " +
      "one — 'already_sent'), so a test blast would leave his text permanently unusable, and sent_count would " +
      "go on reporting deliveries to addresses that no longer exist. Status back to 'draft', counters to 0, " +
      "text untouched.",
  },
  {
    table: "mail_optouts",
    verdict: "keep",
    never: true,
    why:
      "THE STOP LIST. Every row is a person who pressed «Отписаться» — from the letter, or through their mail " +
      "client's one-click header. Clearing it re-subscribes all of them, silently, because that is the only " +
      "place a guest's refusal is recorded (there is no customers row behind a guest checkout). Note the shape " +
      "of the risk: it is not symmetrical. Losing a consent costs a letter that does not go out; losing a " +
      "refusal costs a letter that does. Kept whole, deliberately outliving the customers table this tool " +
      "empties, and checked by name inside the transaction — a stop list that moved is a rollback, in its own " +
      "sentence, not one line of a generic «a keep table changed».",
  },
  {
    table: "push_subscriptions",
    verdict: "keep",
    why:
      "The phones «новый заказ» goes to — the iPhone, the Android and the Mac on the counter, one row each " +
      "(200_push_subscriptions.sql, src/lib/push.ts). Not test data by any reading: a row is a permission the " +
      "owner granted from his own device, and nothing a test does can create one. The asymmetry settles it. A " +
      "stale row costs one request that comes back 410 and retires itself; a cleared LIVE row turns his " +
      "notifications off on the exact morning the orders stop being test orders, and says nothing — the panel's " +
      "switch reads this table, so it would go back to «выключено» with no explanation beside it. " +
      "One honest caveat, because it is the case that will actually happen: a subscription belongs to the ORIGIN " +
      "it was made on. If «Админка» went onto the Home Screen from the staging address and the domain then " +
      "moves (docs/accounts.md), these rows are already dead and he subscribes again once from rempireshop.com. " +
      "That costs a 410 apiece, once — still cheaper than this tool guessing which of the two it is.",
  },
  {
    table: "mail_sends_daily",
    verdict: "keep",
    why:
      "How many letters went out today, per class, against the free plan's hundred (201_mail_budget.sql, " +
      "src/lib/mail-budget.ts). It looks like test data and it is not: the rows are a record of what RESEND " +
      "has already accepted, and the one thing this tool cannot reset is the provider's own counter. Clearing " +
      "it on the morning of go-live would tell the shop it has a full day's allowance it does not have, and " +
      "the letter that then gets refused is «Заказ принят» for the first real order — the exact failure the " +
      "table exists to prevent. Keeping it costs nothing and lasts hours: the key is the UTC day, so the rows " +
      "stop mattering at midnight without anybody deleting them.",
  },
  {
    table: "admin_audit",
    verdict: "keep",
    never: true,
    why:
      "Who did what, and the login ladder. 192_login_ladder_index.sql made the failed-login backoff read these " +
      "rows instead of a Map in one serverless instance — emptying the table resets every attacker's ladder to " +
      "zero. It is also the only record of the owner's own actions. «Clean» does not mean «empty» here: a log " +
      "that is deleted whenever it gets inconvenient is not a log. If it ever genuinely needs trimming, that is " +
      "a separate, considered job with its own retention rule, not a line in a go-live script.",
  },
  {
    table: "_migrations",
    verdict: "keep",
    never: true,
    why:
      "Which migrations have run. Not shop data at all. Deleting a row here makes the next deploy replay that " +
      "migration against a schema that already has it — every file says at the top that it must never run twice.",
  },

  /* ---- test data: orders and everything that hangs off one ---------------- */
  {
    table: "orders",
    verdict: "clear",
    why:
      "Every test basket that reached the bank's page. The reason the whole exercise exists. Clearing them also " +
      "restarts order_number_seq at 100001, so the first real order is R-100001 — safe only because the table " +
      "ends empty, which is asserted.",
  },
  {
    table: "order_messages",
    verdict: "clear",
    why: "The message thread on an order. Meaningless without the order; a foreign key onto it, deleted first by hand rather than by cascade.",
  },
  {
    table: "customers",
    verdict: "clear",
    why:
      "Test accounts, and with them the marketing consent stamped on their rows (marketing, marketing_at, " +
      "marketing_source). That is the right direction: a consent recorded by a test checkout is not consent, " +
      "and deleting the person's row removes them from every future mailing (audienceRows reads customers). " +
      "If one of these is a real person who really did tick the box, this tool destroys their consent and they " +
      "must tick it again — annoying, and safe. The dry run therefore PRINTS every address with marketing=true " +
      "before it deletes anything, so the owner can see whether any of them is somebody real.",
  },
  {
    table: "loyalty_ledger",
    verdict: "clear",
    why:
      "Points earned and spent by test customers. A foreign key onto customers with on delete cascade — deleted " +
      "explicitly first, so the row count is reported and verified rather than happening invisibly.",
  },
  {
    table: "carts",
    verdict: "clear",
    why: "Abandoned test baskets, and the reminded_at stamp that stops the abandoned-cart letter going twice. Both go together.",
  },
  {
    table: "cart_writes",
    verdict: "clear",
    why: "A per-address, per-day counter that rate-limits unproven cart writes (181_cart_writes.sql). Yesterday's counters mean nothing.",
  },
  {
    table: "login_codes",
    verdict: "clear",
    why: "Live one-time sign-in codes for test mailboxes. They expire on their own; there is no reason to carry a valid code into production.",
  },
  {
    table: "stock_alerts",
    verdict: "clear",
    why:
      "«Сообщить, когда появится» requests. Test ones. Clearing is fail-closed — the worst case is a letter " +
      "that never goes out, never one that goes out unwanted. The count is printed in case any of them is real.",
  },
  {
    table: "reviews",
    verdict: "clear",
    why:
      "Fake reviews, in every state. The dry run prints how many are approved, i.e. how many are visible on the " +
      "storefront right now, because that is the number the owner can check against the admin before he agrees.",
  },
  {
    table: "events",
    verdict: "clear",
    why:
      "The analytics stream — views, searches, add-to-cart, purchases. Months of the two of them clicking " +
      "through the shop. Left in place, every report the admin draws for the first real year is wrong.",
  },
  {
    table: "idempotency_keys",
    verdict: "clear",
    why: "Replay protection for requests that were made months ago and answered. The keys are the clients' own; none of those clients exists any more.",
  },
  {
    table: "invoice_counters",
    verdict: "clear",
    why:
      "One row per year: the last invoice number handed out. VAT Act §37 wants invoice numbers unique and " +
      "sequential, and the test orders consumed 1..N of this year's. Since every order carrying those numbers " +
      "is deleted, no invoice survives to be duplicated and resetting gives the first real invoice number 1 " +
      "instead of a sequence that starts at 9 with nothing before it. Guarded: cleared ONLY when the orders " +
      "table ends up empty.",
  },
  {
    table: "gift_cards",
    verdict: "clear",
    why:
      "A gift card is a liability — an amount the shop owes whoever holds the code — so this one was worth " +
      "checking rather than assuming. The schema CAN tell a test card from a real one, contrary to what the " +
      "020_gift_cards.sql comment implies: `order_id` is «the order that bought it (null = issued by hand)», " +
      "and issueGiftCards() in src/lib/giftcards.ts is the only writer of this table anywhere in the app — it " +
      "always sets order_id, and /api/admin/giftcards is GET-only. So today every card belongs to an order, and " +
      "a card is test data exactly when its order is. Two things still stop the tool: a card with a positive " +
      "balance bought by an order that is paid/shipped/delivered (money may really have changed hands), and a " +
      "card with no order behind it at all (typed straight into the database, or issued by a feature added " +
      "after this file). Either one refuses the clear until --gift-cards-are-test-cards says otherwise.",
  },
  {
    table: "gift_card_uses",
    verdict: "clear",
    why: "The card ledger — what each order took off a card and what a refund put back. A foreign key onto gift_cards; deleted first by hand, never by cascade.",
  },
  {
    table: "promo_code_uses",
    verdict: "clear",
    why: "Which test order used which code. The definitions in promo_codes stay; only the usage log goes, and promo_codes.used is reset to match.",
  },
  {
    table: "newsletter_sends",
    verdict: "clear",
    why:
      "One row per address a letter was queued to, with Resend's message id. A delivery log for test blasts to " +
      "addresses that are being deleted in the same transaction. Emptying it is what lets the letter itself go " +
      "back to 'draft' and be sent for real.",
  },

  /* ---- the schema cannot decide -------------------------------------------- */
  {
    table: "stock_levels",
    verdict: "ask",
    group: "stock",
    why:
      "How many bottles of each size the shop believes it has. Whether that is test data is not a question the " +
      "database can answer: a goods-in scan of a real shelf is real, and a test web order that took 1 off it is " +
      "not. Both are in the number. So it is a flag, and the flag takes the two stock tables together — see " +
      "stock_moves. One thing the owner must be told before he reaches for that flag, and the dry run prints it: " +
      "this table also holds the BARCODES. tools/seed-stock.mjs found a real EAN on none of the 153 harvested " +
      "Shopify variants (they all say \"NA\"), so every barcode in here was scanned or typed by a person in the " +
      "admin and there is nowhere to fetch it back from.",
  },
  {
    table: "stock_moves",
    verdict: "ask",
    group: "stock",
    why:
      "The ledger behind the count, and it may NOT be separated from it. Two ways round, both broken. Clear the " +
      "moves and keep the levels: src/lib/inventory.ts only treats a variant as numerically tracked once it has " +
      "a real counting move, so the whole catalogue silently drops out of numeric stock and the public badges " +
      "revert to the manual override — no error, just wrong. Clear the levels and keep the moves: a history of " +
      "movements for rows that no longer exist. --stock takes both or neither.",
  },
];

/** Settings rows deleted by key. The table itself is a KEEP table. */
export const SETTINGS_CLEAR_KEYS = [
  /* «Последний запуск: 10.09 07:00 — отправлено 1» under each letter in the
     panel (recordFlowRun, src/lib/flows.ts). Display only — nothing reads it
     to decide whether to send, and the three things that DO dedupe a letter
     (carts.reminded_at, customers.birthday_sent_year, stock_alerts.sent_at)
     are all in tables this tool empties. A shop that has mailed nobody must
     not tell its owner it mailed one person. */
  "flow_runs",
];

/** Settings rows deleted by key only when a flag says so. */
export const SETTINGS_ASK_KEYS = {
  /* The 164-check acceptance list Renat and Dim filled in on two phones
     (src/lib/testplan.ts, one row, key `testplan_answers`). It has «test» in
     the name and it is NOT shop data — it is the record that the shop was
     checked, which is worth more the day after go-live than the day before.
     One row, invisible to every customer, costs nothing to keep. Kept by
     default; --testplan clears it for anyone who disagrees. */
  testplan: "testplan_answers",
};

/** Children before parents. No cascade anywhere — see rule 2 in the header. */
export const DELETE_ORDER = [
  "order_messages",
  "gift_card_uses",
  "gift_cards",
  "promo_code_uses",
  "loyalty_ledger",
  "newsletter_sends",
  "carts",
  "cart_writes",
  "login_codes",
  "stock_alerts",
  "reviews",
  "events",
  "idempotency_keys",
  "invoice_counters",
  "orders",
  "customers",
];

/** Both, in this order, and only when --stock. */
export const STOCK_ORDER = ["stock_moves", "stock_levels"];

/** Long, ASCII, and impossible to type by accident or to half-mean. */
export const CONFIRM_PHRASE = "I HAVE A BACKUP AND I WANT TO DELETE THE TEST DATA";

export const byVerdict = (v) => PLAN.filter((p) => p.verdict === v).map((p) => p.table);

/* ---------- fingerprints ------------------------------------------------- */

const IDENT = /^[a-z_][a-z0-9_]*$/;

async function rows(db, sql, params) {
  const res = await db.query(sql, params);
  return (res && res.rows) || [];
}

/**
 * `{ n, fp }` for one table: how many rows, and an md5 over the rows' own text
 * so «unchanged» means unchanged rather than «the same number of rows».
 *
 * `cols` narrows the fingerprint to the columns that must not move, for the
 * two tables this tool deliberately edits a counter on. `where` narrows the
 * rows, for `settings` minus the keys it deliberately removes.
 *
 * Identifiers are checked against IDENT and every one of them is a constant in
 * this file — nothing here ever sees a value from the database or the CLI.
 */
async function stats(db, table, { cols, where, countOnly } = {}) {
  if (!IDENT.test(table)) throw new Error(`go-live-reset: refusing to touch «${table}»`);
  if (cols) for (const c of cols) if (!IDENT.test(c)) throw new Error(`go-live-reset: bad column «${c}»`);
  /* A table on the clear list is proved by its count alone — «0 rows» needs no
     fingerprint, and `events` is the one table here that can hold tens of
     thousands of rows, i.e. a multi-megabyte string_agg for nothing. */
  const row = cols ? `(${cols.map((c) => `t.${c}`).join(", ")})::text` : "t::text";
  const fp = countOnly
    ? "'(count only)' as fp"
    : `coalesce(md5(string_agg(${row}, chr(1) order by ${row})), '-') as fp`;
  const r = await rows(db, `select count(*)::int as n, ${fp} from ${table} t${where ? ` where ${where}` : ""}`);
  return { n: Number(r[0]?.n ?? 0), fp: String(r[0]?.fp ?? "-") };
}

/**
 * The columns this tool is ALLOWED to change on the two KEEP tables it edits.
 * Everything else on those tables is fingerprinted and must come out identical.
 *
 * Stated as «what may move» rather than «what must not», and the must-not list
 * is then read out of information_schema at run time. 170_promo_scope.sql added
 * two columns to promo_codes after the first draft of this file; a hand-written
 * keep-list would have silently stopped covering them, which is the quiet kind
 * of wrong a verification step exists to avoid.
 */
const PROMO_MUTABLE = ["used"];
const NEWSLETTER_MUTABLE = [
  "status", "sent_at", "sending_at", "sent_count", "failed_count", "audience_count", "updated_at",
];

async function columnsExcept(db, table, mutable) {
  const r = await rows(
    db,
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  const skip = new Set(mutable);
  const cols = r.map((x) => String(x.column_name)).filter((c) => !skip.has(c));
  if (!cols.length) throw new Error(`go-live-reset: ${table} has no columns to fingerprint`);
  return cols;
}

function settingsWhere(keys) {
  if (!keys.length) return undefined;
  for (const k of keys) if (!IDENT.test(k)) throw new Error(`go-live-reset: bad settings key «${k}»`);
  return `t.key not in (${keys.map((k) => `'${k}'`).join(", ")})`;
}

/** Every number the verification compares, before and after. */
async function snapshot(db, settingsKeysGoing) {
  const tables = {};
  for (const p of PLAN) tables[p.table] = await stats(db, p.table, { countOnly: p.verdict === "clear" });
  return {
    tables,
    /* the two we edit a counter on, fingerprinted without the columns that move */
    promoCodesKept: await stats(db, "promo_codes", { cols: await columnsExcept(db, "promo_codes", PROMO_MUTABLE) }),
    newslettersKept: await stats(db, "newsletters", {
      cols: await columnsExcept(db, "newsletters", NEWSLETTER_MUTABLE),
    }),
    /* settings minus the rows we are deliberately deleting by key */
    settingsKept: await stats(db, "settings", { where: settingsWhere(settingsKeysGoing) }),
  };
}

/* ---------- what the database can tell us before anything happens -------- */

async function one(db, sql, params) {
  const r = await rows(db, sql, params);
  return r[0] || {};
}

/**
 * The gift-card liability check, and it has to run BEFORE the orders are gone:
 * once `orders` is empty every card looks like an orphan.
 */
async function giftCardGuard(db) {
  const live = await one(
    db,
    `select count(*)::int as n, coalesce(sum(balance), 0)::text as total
       from gift_cards where voided_at is null and balance > 0`,
  );
  const paid = await one(
    db,
    `select count(*)::int as n, coalesce(sum(g.balance), 0)::text as total
       from gift_cards g
       join orders o on o.id = g.order_id
      where g.voided_at is null and g.balance > 0
        and o.status in ('paid', 'shipped', 'delivered')`,
  );
  const orphan = await one(
    db,
    `select count(*)::int as n, coalesce(sum(g.balance), 0)::text as total
       from gift_cards g
      where g.voided_at is null and g.balance > 0
        and (g.order_id is null or not exists (select 1 from orders o where o.id = g.order_id))`,
  );
  const num = (x) => Number(x.total || 0);
  return {
    live: { n: Number(live.n || 0), total: num(live) },
    paid: { n: Number(paid.n || 0), total: num(paid) },
    orphan: { n: Number(orphan.n || 0), total: num(orphan) },
    get blocked() {
      return this.paid.n > 0 || this.orphan.n > 0;
    },
  };
}

/** Things the owner should look at with his own eyes before he agrees. */
async function eyeballs(db) {
  const consents = await rows(
    db,
    `select email, marketing_source, to_char(marketing_at, 'YYYY-MM-DD') as marketing_day
       from customers where marketing = true order by email limit 50`,
  );
  /* Everybody ELSE this run deletes. The consent list above answers «whose
     permission am I throwing away», which is not the same question as «who am
     I deleting» — and the second one has the bigger answer, because a customer
     who never ticked the box is still a real person with a real account. The
     owner's own rule for the Shopify import says exactly that: an imported
     customer arrives with NO marketing consent, which is not opted out. Until
     19.09.2026 those rows were invisible in the dry run by construction: it
     selected `marketing = true` and nothing else. Audit F47. */
  const quiet = await rows(
    db,
    `select email, to_char(created_at, 'YYYY-MM-DD') as created_day
       from customers where marketing is distinct from true order by email limit 50`,
  );
  const quietTotal = await one(db, "select count(*)::int as n from customers where marketing is distinct from true");
  /* «Сообщите, когда появится» — an address someone typed to be told about one
     bottle. It was printed as a bare count and deleted with everything else. */
  const alerts = await rows(
    db,
    "select distinct email from stock_alerts where email is not null order by email limit 50",
  );
  const approved = await one(db, "select count(*)::int as n from reviews where status = 'approved'");
  const stockMoves = await rows(
    db,
    `select reason, count(*)::int as n from stock_moves group by reason order by reason`,
  );
  const invoices = await one(db, "select count(*)::int as n from orders where invoice is not null");
  /* Every one of these was scanned or typed by a person. tools/seed-stock.mjs
     found zero real barcodes in the whole Shopify harvest (all 153 variants
     carry `"NA"`), so there is nowhere to get them back from. */
  const eans = await one(db, "select count(*)::int as n from stock_levels where ean is not null");
  return {
    boundEans: Number(eans.n || 0),
    consents: consents.map((r) => ({
      email: String(r.email),
      source: r.marketing_source == null ? "" : String(r.marketing_source),
      at: r.marketing_day == null ? "" : String(r.marketing_day),
    })),
    quiet: quiet.map((r) => ({
      email: String(r.email),
      at: r.created_day == null ? "" : String(r.created_day),
    })),
    quietTotal: Number(quietTotal.n || 0),
    alerts: alerts.map((r) => String(r.email)),
    approvedReviews: Number(approved.n || 0),
    stockMoves: stockMoves.map((r) => ({ reason: String(r.reason), n: Number(r.n) })),
    invoicedOrders: Number(invoices.n || 0),
  };
}

/* ---------- schema ------------------------------------------------------- */

async function readSchema(db) {
  const r = await rows(
    db,
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  return r.map((x) => String(x.table_name));
}

/**
 * A table the plan does not name is a refusal, not a default.
 *
 * 194 is the highest migration as this is written and two landed the same day;
 * there will be a 195. Whoever writes it must come back here and say what the
 * new table is for, in one line, next to the others. Silently keeping it would
 * be the safe direction and is still the wrong one — the whole value of this
 * file is that somebody thought about every table by name.
 */
export function schemaProblems(schema) {
  return [...schemaExtras(schema), ...schemaMissing(schema)];
}

/** Tables the database has and the plan does not. Tolerated by a dry run, fatal to a clear. */
export function schemaExtras(schema) {
  const known = new Set(PLAN.map((p) => p.table));
  return schema
    .filter((t) => !known.has(t))
    .map((t) => `the database has a table this tool has never been told about: ${t}`);
}

/**
 * Tables the plan names and the database has not. Fatal to BOTH, because the
 * dry run's first act is to count every one of them: there is nothing useful to
 * say about a database the migrations have not been applied to.
 */
export function schemaMissing(schema) {
  return PLAN.filter((p) => !schema.includes(p.table)).map(
    (p) => `the plan names a table the database does not have: ${p.table} — run \`npm run migrate\` first`,
  );
}

/* ---------- verification ------------------------------------------------- */

export class ResetRefused extends Error {
  constructor(problems) {
    super(problems.join("\n"));
    this.name = "ResetRefused";
    this.problems = problems;
  }
}

/**
 * Run inside the transaction, before the commit. Anything on this list is a
 * rollback: the point is that a reset which took the shop's settings with it
 * fails on the morning, in front of the person running it.
 */
export function verify(before, after, opts) {
  const problems = [];
  const clearing = new Set(byVerdict("clear"));
  if (opts.stock) for (const t of STOCK_ORDER) clearing.add(t);

  for (const p of PLAN) {
    const b = before.tables[p.table];
    const a = after.tables[p.table];
    if (clearing.has(p.table)) {
      if (a.n !== 0) problems.push(`${p.table}: should be empty, still has ${a.n} row(s)`);
      continue;
    }
    /* Three KEEP tables are edited on purpose and are checked just below,
       against a fingerprint over exactly the columns (or rows) that may NOT
       move. `settings` also legitimately loses rows — the keys named in
       SETTINGS_CLEAR_KEYS — so its size is not compared here. */
    if (p.table === "settings") continue;
    if (a.n !== b.n) problems.push(`${p.table}: ${b.n} row(s) before, ${a.n} after — a KEEP table must not change size`);
    if (p.table === "promo_codes" || p.table === "newsletters") continue;
    if (a.fp !== b.fp) problems.push(`${p.table}: contents changed (${b.n} rows both sides, different fingerprint)`);
  }

  /* settings: every row that is not one of the keys removed by name must be
     byte-identical, and nothing may be left behind besides those rows. */
  if (after.settingsKept.n !== before.settingsKept.n || after.settingsKept.fp !== before.settingsKept.fp) {
    problems.push(
      `settings: a row other than the keys this tool removes by name was changed ` +
        `(${before.settingsKept.n} → ${after.settingsKept.n} rows outside those keys)`,
    );
  }
  if (after.tables.settings.n !== after.settingsKept.n) {
    problems.push("settings: the keys this tool was asked to remove are still there");
  }
  if (after.promoCodesKept.fp !== before.promoCodesKept.fp) {
    problems.push("promo_codes: something other than the `used` counter changed");
  }
  if (after.newslettersKept.fp !== before.newslettersKept.fp) {
    problems.push("newsletters: the letters themselves changed — only the send state may be reset");
  }
  /* Said by name because it is the one that matters most, and because a
     generic «a keep table changed» message is not what anybody should read
     when the stop list has been touched. */
  const mo = { b: before.tables.mail_optouts, a: after.tables.mail_optouts };
  if (mo.a.n !== mo.b.n || mo.a.fp !== mo.b.fp) {
    problems.push(`mail_optouts: THE STOP LIST CHANGED (${mo.b.n} → ${mo.a.n}). Nothing may ever do this.`);
  }
  return problems;
}

/* ---------- the run ------------------------------------------------------ */

/**
 * Look, decide, and — only with opts.clear — do it.
 *
 * Returns a report either way. Throws ResetRefused when it will not proceed;
 * by then nothing has been written, or the transaction has been rolled back.
 */
export async function goLiveReset(db, opts = {}) {
  const clear = Boolean(opts.clear);
  const stock = Boolean(opts.stock);
  const testplan = Boolean(opts.testplan);
  const giftCardsAreTest = Boolean(opts.giftCardsAreTest);

  const schema = await readSchema(db);
  const missing = schemaMissing(schema);
  if (missing.length) throw new ResetRefused(missing); // nothing to count, dry run or not
  const schemaIssues = schemaExtras(schema);
  if (schemaIssues.length && clear) throw new ResetRefused(schemaIssues);

  const settingsKeysGoing = [...SETTINGS_CLEAR_KEYS, ...(testplan ? [SETTINGS_ASK_KEYS.testplan] : [])];
  const before = await snapshot(db, settingsKeysGoing);
  const guard = await giftCardGuard(db);
  const look = await eyeballs(db);
  for (const k of settingsKeysGoing) if (!IDENT.test(k)) throw new Error(`go-live-reset: bad settings key «${k}»`);
  const settingsPresent = settingsKeysGoing.length
    ? (
        await rows(db, `select key from settings where ${settingsKeysGoing.map((k) => `key = '${k}'`).join(" or ")}`)
      ).map((r) => String(r.key))
    : [];

  const report = {
    mode: clear ? "clear" : "dry",
    stock,
    testplan,
    schemaIssues,
    before,
    after: null,
    guard,
    look,
    settingsKeysGoing,
    settingsKeysPresent: settingsPresent,
    changed: { promoCodes: 0, newsletters: 0, sequence: false, invoiceYears: before.tables.invoice_counters.n },
  };

  if (!clear) return report;

  if (guard.blocked && !giftCardsAreTest) {
    throw new ResetRefused([
      guard.paid.n
        ? `${guard.paid.n} gift card(s) with ${guard.paid.total.toFixed(2)} EUR still on them were bought by an order that is paid/shipped/delivered. Somebody may have handed over money for those.`
        : null,
      guard.orphan.n
        ? `${guard.orphan.n} gift card(s) with ${guard.orphan.total.toFixed(2)} EUR on them have no order behind them. This shop's code cannot create such a card, so it was put there another way and this tool will not guess what it is.`
        : null,
      "Check them in the admin. If they really are test cards, add --gift-cards-are-test-cards.",
    ].filter(Boolean));
  }

  /* REPEATABLE READ, and the before-picture is taken INSIDE it.
     Until 19.09.2026 `before` was the snapshot taken above, outside any
     transaction, and `verify()` compared it with an after-picture taken
     inside. Anything that committed in between — the owner signing in, which
     writes one admin_audit row; Dim ticking an item on /golive/ from his
     phone while the tool runs; any setting saved — made a KEEP table «change
     size» and rolled the whole clear back with «NOTHING WAS CHANGED». Safe,
     but on the morning of the launch it reads as a failure of the tool rather
     than as somebody having touched the panel (audit F46). With one snapshot
     for the whole transaction, both pictures are of the same instant and the
     comparison means what it says. */
  await db.query("begin isolation level repeatable read");
  try {
    const beforeTx = await snapshot(db, settingsKeysGoing);

    for (const t of DELETE_ORDER) await db.query(`delete from ${t}`);
    if (stock) for (const t of STOCK_ORDER) await db.query(`delete from ${t}`);

    /* promo_codes.used counts promo_code_uses rows, which are now gone.
       `returning` rather than rowCount: node-postgres calls it rowCount,
       PGlite affectedRows, and the test rig hands this function a thin
       adapter that has neither — a returned row is the one shape all three
       agree on. */
    const promo = await db.query("update promo_codes set used = 0 where used <> 0 returning code");
    report.changed.promoCodes = ((promo && promo.rows) || []).length;

    /* The letter stays, its send state does not — see the PLAN entry. */
    const news = await db.query(
      `update newsletters
          set status = 'draft', sent_at = null, sending_at = null,
              sent_count = 0, failed_count = 0, audience_count = 0, updated_at = now()
        where status <> 'draft' or sent_at is not null or sending_at is not null
           or sent_count <> 0 or failed_count <> 0 or audience_count <> 0
      returning id`,
    );
    report.changed.newsletters = ((news && news.rows) || []).length;

    for (const k of settingsKeysGoing) await db.query("delete from settings where key = $1", [k]);

    /* Only because the table ends empty. ALTER SEQUENCE … RESTART is DDL and
       rolls back with everything else, unlike setval(). */
    const left = await one(db, "select count(*)::int as n from orders");
    if (Number(left.n) === 0) {
      await db.query("alter sequence order_number_seq restart with 100001");
      report.changed.sequence = true;
    }

    const after = await snapshot(db, settingsKeysGoing);
    report.after = after;
    const problems = verify(beforeTx, after, { stock });
    if (problems.length) {
      await db.query("rollback");
      report.after = null;
      throw new ResetRefused(["NOTHING WAS CHANGED — the transaction was rolled back.", ...problems]);
    }
    await db.query("commit");
    return report;
  } catch (err) {
    if (!(err instanceof ResetRefused)) {
      try {
        await db.query("rollback");
      } catch {
        /* the driver may already have aborted it */
      }
    }
    throw err;
  }
}

/* ---------- printing ----------------------------------------------------- */

/** Never print the password. `postgres://u:p@host:5432/db` → `host:5432/db`. */
export function maskUrl(url) {
  if (!url) return "(none)";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const pad = (s, n) => String(s).padEnd(n, " ");
const padL = (s, n) => String(s).padStart(n, " ");

export function formatReport(report, { url } = {}) {
  const L = [];
  const dry = report.mode === "dry";
  const w = Math.max(...PLAN.map((p) => p.table.length)) + 2;

  L.push(dry ? "go-live-reset — DRY RUN. Nothing below has happened." : "go-live-reset — CLEARED.");
  L.push(`database: ${maskUrl(url)}`);
  L.push("");

  if (report.schemaIssues.length) {
    L.push("SCHEMA");
    for (const s of report.schemaIssues) L.push(`  ! ${s}`);
    L.push("  A clear will refuse until every table has a line in tools/go-live-reset.mjs PLAN.");
    L.push("");
  }

  const rowsOf = (v) => PLAN.filter((p) => p.verdict === v);
  const total = (v) => rowsOf(v).reduce((n, p) => n + report.before.tables[p.table].n, 0);

  L.push(`CLEAR — test data · ${rowsOf("clear").length} tables, ${total("clear")} rows`);
  for (const p of rowsOf("clear")) {
    const b = report.before.tables[p.table].n;
    const a = report.after ? report.after.tables[p.table].n : 0;
    L.push(`  ${pad(p.table, w)}${padL(b, 7)} → ${a}`);
  }
  L.push("");

  L.push(`KEEP — the shop, and the records · ${rowsOf("keep").length} tables, ${total("keep")} rows`);
  for (const p of rowsOf("keep")) {
    const b = report.before.tables[p.table].n;
    const note = p.never
      ? "  never cleared, by any flag"
      : p.table === "settings" && report.settingsKeysPresent.length
        ? `, minus ${report.settingsKeysPresent.length} key(s) removed by name — see ALSO`
        : "";
    L.push(`  ${pad(p.table, w)}${padL(b, 7)}   untouched${note}`);
  }
  L.push("");

  const ask = rowsOf("ask");
  L.push(`${report.stock ? "STOCK — clearing, because --stock was given" : "ASK — not touched without --stock"} · ${ask.length} tables`);
  for (const p of ask) {
    const b = report.before.tables[p.table].n;
    const a = report.after ? report.after.tables[p.table].n : report.stock ? 0 : b;
    L.push(`  ${pad(p.table, w)}${padL(b, 7)} → ${a}`);
  }
  if (report.look.stockMoves.length) {
    L.push(`  moves by reason: ${report.look.stockMoves.map((s) => `${s.reason} ${s.n}`).join(", ")}`);
    L.push("  goods_in / adjust / return are somebody counting a real shelf; sale_web / sale_pos are test orders.");
  }
  if (report.look.boundEans) {
    L.push(
      `  ${report.look.boundEans} barcode(s) are bound to a stock row. Every one was scanned or typed by hand —` +
        " the Shopify harvest has none, so --stock loses them for good.",
    );
  }
  L.push("");

  L.push("ALSO, in the same transaction");
  L.push(
    `  promo_codes.used      reset to 0 on ${report.after ? `${report.changed.promoCodes} code(s)` : "the codes that have one"} — definitions kept`,
  );
  L.push(
    `  newsletters           ${report.after ? `${report.changed.newsletters} letter(s)` : "any that were sent or sending"} put back to draft — text kept`,
  );
  L.push(`  settings keys removed  ${report.settingsKeysPresent.length ? report.settingsKeysPresent.join(", ") : "(none of them are set)"}`);
  if (!report.testplan) L.push("  settings.testplan_answers  KEPT — the acceptance record. --testplan clears it.");
  L.push(`  order_number_seq      ${report.changed.sequence ? "restarted at 100001" : "restart to 100001 once orders is empty"}`);
  L.push(`  invoice_counters      ${report.changed.invoiceYears} year row(s) — the numbering starts again at 1`);
  L.push("");

  L.push("GIFT CARDS — a card is money the shop owes");
  L.push(`  live (balance > 0, not voided): ${report.guard.live.n}, ${report.guard.live.total.toFixed(2)} EUR`);
  L.push(`  of those, bought by a paid/shipped/delivered order: ${report.guard.paid.n}, ${report.guard.paid.total.toFixed(2)} EUR`);
  L.push(`  of those, with no order behind them at all: ${report.guard.orphan.n}, ${report.guard.orphan.total.toFixed(2)} EUR`);
  if (report.guard.blocked) {
    L.push(
      dry
        ? "  ! A clear will REFUSE until you look at these and pass --gift-cards-are-test-cards."
        : "  ! These were destroyed anyway, because --gift-cards-are-test-cards was given.",
    );
  }
  L.push("");

  L.push("LOOK AT THESE BEFORE YOU AGREE");
  L.push(`  reviews visible on the storefront right now: ${report.look.approvedReviews}`);
  L.push(`  orders carrying an invoice number: ${report.look.invoicedOrders}`);
  L.push(`  customers with marketing = true: ${report.look.consents.length}${report.look.consents.length === 50 ? "+ (first 50)" : ""}`);
  for (const c of report.look.consents) L.push(`      ${c.email}${c.source ? `  (${c.source}${c.at ? ", " + c.at : ""})` : ""}`);
  /* Printed with the same weight as the consents, because deleting somebody
     who never agreed to anything is still deleting somebody. */
  L.push(`  customers WITHOUT marketing consent, also deleted: ${report.look.quietTotal}${report.look.quiet.length === 50 ? " (first 50 shown)" : ""}`);
  for (const c of report.look.quiet) L.push(`      ${c.email}${c.at ? `  (${c.at})` : ""}`);
  if (report.look.alerts.length) {
    L.push(`  «сообщите, когда появится» addresses, also deleted: ${report.look.alerts.length}${report.look.alerts.length === 50 ? "+ (first 50)" : ""}`);
    for (const e of report.look.alerts) L.push(`      ${e}`);
  }
  L.push("  Their consent is deleted with them. If one of these is a real person, they must tick the box again.");
  L.push("  mail_optouts is NOT touched: a refusal outlives the account it was given from.");
  L.push("");

  if (dry) {
    /* Carries back whatever was already asked for, so this line can be pasted
       as it stands — the flags are the awkward part to remember, not the
       confirmation, which is right here. */
    const flags =
      (report.stock ? " --stock" : "") +
      (report.testplan ? " --testplan" : "") +
      (report.guard.blocked ? " --gift-cards-are-test-cards" : "");
    L.push("Nothing was changed. To do it for real:");
    L.push(`  node tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}"${flags}`);
    if (report.guard.blocked) L.push("  — and only after you have looked at the gift cards above.");
  } else {
    L.push("Done, in one transaction, with every KEEP table verified unchanged before the commit.");
  }
  return L.join("\n");
}

/* ---------- CLI ---------------------------------------------------------- */

function parseArgs(argv) {
  const out = { clear: false, stock: false, testplan: false, giftCardsAreTest: false, confirm: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clear") out.clear = true;
    else if (a === "--stock") out.stock = true;
    else if (a === "--testplan") out.testplan = true;
    else if (a === "--gift-cards-are-test-cards") out.giftCardsAreTest = true;
    else if (a === "--confirm") out.confirm = argv[++i] ?? "";
    else if (a.startsWith("--confirm=")) out.confirm = a.slice("--confirm=".length);
    else if (a === "--help" || a === "-h") out.help = true;
    else out.unknown = a;
  }
  return out;
}

const USAGE = `go-live-reset — remove the staging test data before the shop opens.

  node tools/go-live-reset.mjs                          dry run: prints, changes nothing
  node tools/go-live-reset.mjs --clear --confirm "…"    clears, in one transaction

  --stock                        also clear stock_levels AND stock_moves (never one alone)
  --testplan                     also clear settings.testplan_answers
  --gift-cards-are-test-cards    proceed past the gift-card liability check
  DB_DRIVER=pglite               run against an empty in-memory Postgres instead

Read docs/go-live-reset.md first. Its first step is the Railway snapshot.`;

async function connect() {
  if (process.env.DB_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    await migrate(db);
    return { db, close: () => db.close(), url: "" };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local (see docs/backend.md) or run with DB_DRIVER=pglite.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  return { db: client, close: () => client.end(), url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.unknown) {
    console.error(`Unknown argument: ${args.unknown}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.clear && args.confirm !== CONFIRM_PHRASE) {
    console.error(
      "--clear needs the confirmation, spelled exactly. Paste this line:\n\n" +
        `  node tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}"` +
        (args.stock ? " --stock" : "") +
        (args.testplan ? " --testplan" : "") +
        (args.giftCardsAreTest ? " --gift-cards-are-test-cards" : "") +
        "\n\nAnd take the Railway snapshot first — docs/go-live-reset.md, step 1.",
    );
    process.exit(2);
  }
  if (!args.clear && args.confirm) {
    console.error("--confirm without --clear does nothing. Add --clear when you mean it.");
    process.exit(2);
  }

  const { db, close, url } = await connect();
  try {
    const report = await goLiveReset(db, args);
    console.log(formatReport(report, { url }));
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    if (err instanceof ResetRefused) {
      console.error("\ngo-live-reset REFUSED — nothing was changed.\n");
      for (const p of err.problems) console.error(`  · ${p}`);
      console.error("");
      process.exit(3);
    }
    console.error(err);
    process.exit(1);
  });
}
