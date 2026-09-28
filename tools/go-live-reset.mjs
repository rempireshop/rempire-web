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
 *   node --env-file=.env.railway.txt tools/go-live-reset.mjs                 # DRY RUN — prints, changes nothing
 *   node --env-file=.env.railway.txt tools/go-live-reset.mjs --clear --confirm "…"   # the real thing
 *
 * On launch day both carry `--stock --test-content` as well (the owner's
 * decisions of 28.09.2026): every promo code, set, blog post and newsletter,
 * every own product with its edits, and every stock count and barcode on
 * staging is test data too — the real counts come from Shopify right after
 * (tools/import-shopify-stock.mjs). See TEST CONTENT below.
 *
 * Read docs/go-live-reset.md before running it. Its first instruction is to
 * take a copy of the database (tools/db-backup.mjs) and check that it reads
 * back, because nothing here is undoable and a rollback is a restore.
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
 *    it found, and asks for a flag. `--stock` is one; `--test-content` is the
 *    other — the database cannot tell a made-up set or a «Claude test товар»
 *    from the real thing, the owner can, and on 28.09.2026 he did: all of it
 *    is test data. The dry run prints every one by name before he agrees.
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
import { readFileSync } from "node:fs";
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
      "is what he changed about it. Deleting it silently reverts every price edit he has made. The one " +
      "exception is --test-content, and it is by row, never by table: the rows keyed to an own product that " +
      "flag deletes go with that product; every imported product's row is fingerprinted and must not move.",
  },
  {
    table: "custom_products",
    verdict: "keep",
    content: true,
    why:
      "Products that exist only here, not in the Shopify-derived catalogue (ids `c-…`). Kept by default. On " +
      "28.09.2026 the owner said all eight on staging are test products — none exists in Shopify — so " +
      "--test-content deletes every row, with its product_overrides and stock rows, except the ids named by " +
      "--keep-product (for a real own product Renat adds before the night).",
  },
  {
    table: "bundles",
    verdict: "keep",
    content: true,
    why:
      "Set definitions (name and description in three languages, contents, price or discount). Seeded by " +
      "120_bundles.sql and edited in the admin since. Catalogue, not orders — kept by default. --test-content " +
      "deletes them all: the owner's decision of 28.09.2026 is that every set on staging is made up, and the " +
      "storefront hides «Наборы» by itself while there is no active set.",
  },
  {
    table: "posts",
    verdict: "keep",
    content: true,
    why:
      "Blog articles, drafts and published alike, in three languages with covers and SEO. 071_blog_samples.sql " +
      "seeded some and he has been rewriting them since; nothing here distinguishes a seeded post from one he " +
      "wrote, and it must not — both are the shop's content. Kept by default; --test-content deletes every " +
      "row (the owner's decision of 28.09.2026: all of them are test texts), and the storefront hides the blog " +
      "by itself until the first post is published. Tags and product cards are columns, not child tables.",
  },
  {
    table: "promo_codes",
    verdict: "keep",
    content: true,
    why:
      "Promo code DEFINITIONS — the code, the percent, the floor, the dates, the cap. These are marketing he " +
      "set up, not something a test order created. The `used` counter on them is a different matter: it counts " +
      "rows in promo_code_uses, which this tool empties, so it is reset to 0 in the same transaction. A code " +
      "with max_uses = 10 that was tested ten times would otherwise be dead on launch morning. --test-content " +
      "deletes the definitions too (28.09.2026: every code on staging is a test code).",
  },
  {
    table: "newsletters",
    verdict: "keep",
    content: true,
    why:
      "The letters themselves — his title, subject and body in three languages and the product cards under " +
      "them. Kept, because he wrote them. But the SEND STATE on them is cleared in the same transaction: a " +
      "letter with status='sent' is frozen for good (src/lib/newsletters.ts refuses to edit, delete or re-send " +
      "one — 'already_sent'), so a test blast would leave his text permanently unusable, and sent_count would " +
      "go on reporting deliveries to addresses that no longer exist. Status back to 'draft', counters to 0, " +
      "text untouched. --test-content deletes the letters themselves (28.09.2026: all seven are test texts).",
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
      "Every test basket that reached the bank's page. The reason the whole exercise exists. The NUMBERS do " +
      "not start again: an order number is the merchantReference Montonio keeps for good, and since the live " +
      "hour of 26.09.2026 R-100095…R-100098 exist in the LIVE Montonio account. A first real order numbered " +
      "R-100001 would one day be followed by a second R-100095. So order_number_seq continues after the highest " +
      "number the shop has ever handed out — read inside the transaction, before the delete — and never moves " +
      "lower (nextOrderNumber()).",
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
    table: "cart_returns",
    verdict: "clear",
    why:
      "«Вернулись по письму» in «Аналитика» — one bare timestamp per order that came after the abandoned-cart " +
      "letter (213_cart_returned_by_letter.sql). Test orders after test letters; left in place, the first real " +
      "month's count starts with them.",
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
  {
    table: "owner_alerts",
    verdict: "clear",
    why:
      "The owner's alerts already sent, one row per event (217_owner_alerts.sql, src/lib/owner-alerts.ts): a " +
      "refund Montonio could not pay, a payment the nightly check found, a parcel refused or sent back. Every row " +
      "is about a test order this tool deletes. And it must go, not merely may: a row is a once-only key built " +
      "from an order number (`payment_recovered:R-100001`), so if the numbers start again after the reset a " +
      "stale key would silence the first real alert of that kind for that number.",
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
      "admin and there is nowhere to fetch it back from. (On 28.09.2026 the owner answered for staging: every " +
      "count and every barcode there is a test, the launch-day reset runs WITH --stock, and the Shopify import " +
      "writes the real counts straight after.) --test-content is not --stock: it deletes only the " +
      "rows of the own products it deletes (in both stock tables, as a pair), and every imported product's " +
      "count, barcode and history is fingerprinted and must come out identical.",
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
  "cart_returns",
  "login_codes",
  "stock_alerts",
  "reviews",
  "events",
  "idempotency_keys",
  "invoice_counters",
  "owner_alerts",
  "orders",
  "customers",
];

/** Both, in this order, and only when --stock. */
export const STOCK_ORDER = ["stock_moves", "stock_levels"];

/**
 * --test-content (the owner's decision of 28.09.2026). Four KEEP tables that
 * are emptied whole — their only children, promo_code_uses and
 * newsletter_sends, are on DELETE_ORDER and are gone before these run. Posts
 * and bundles have no child tables: a post's tags and product cards and a
 * set's contents are columns on the row itself.
 */
export const TEST_CONTENT_TABLES = ["promo_codes", "bundles", "posts", "newsletters"];

/**
 * …and the own products, deleted BY ROW from the four tables keyed to a
 * product id, children first (none of them has a foreign key; the order is
 * the one a person would reason in). Every other row of these tables belongs
 * to an imported product and is fingerprinted before and after.
 */
export const OWN_PRODUCT_KEYS = [
  ["stock_moves", "product_id"],
  ["stock_levels", "product_id"],
  ["product_overrides", "product_id"],
  ["custom_products", "id"],
];

/** src/lib/custom-products.ts CUSTOM_PREFIX — how every own product id starts. */
export const OWN_PREFIX = "c-";

/** What an id given to --keep-product may look like: the shape isCustomId() allows, and never anything a shell would read. */
const KEEP_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

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
 * Values (the own product ids of --test-content) travel as `params`, never
 * inside the SQL text.
 */
async function stats(db, table, { cols, where, params, countOnly } = {}) {
  if (!IDENT.test(table)) throw new Error(`go-live-reset: refusing to touch «${table}»`);
  if (cols) for (const c of cols) if (!IDENT.test(c)) throw new Error(`go-live-reset: bad column «${c}»`);
  /* A table on the clear list is proved by its count alone — «0 rows» needs no
     fingerprint, and `events` is the one table here that can hold tens of
     thousands of rows, i.e. a multi-megabyte string_agg for nothing. */
  const row = cols ? `(${cols.map((c) => `t.${c}`).join(", ")})::text` : "t::text";
  const fp = countOnly
    ? "'(count only)' as fp"
    : `coalesce(md5(string_agg(${row}, chr(1) order by ${row})), '-') as fp`;
  const r = await rows(db, `select count(*)::int as n, ${fp} from ${table} t${where ? ` where ${where}` : ""}`, params);
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

/**
 * With --test-content, the four product-keyed tables lose exactly the own
 * products' rows. Two pictures per table: the rows that must NOT move (every
 * imported product's edits, counts, barcodes and history, and the own products
 * --keep-product spared) with a fingerprint, and the rows that must be gone,
 * by count. `going` is a list of ids read from the database — a parameter,
 * never text in the SQL.
 */
async function ownProductStats(db, going) {
  const out = {};
  for (const [table, col] of OWN_PRODUCT_KEYS) {
    out[table] = {
      kept: await stats(db, table, { where: `not (t.${col} = any($1::text[]))`, params: [going] }),
      going: await stats(db, table, { where: `t.${col} = any($1::text[])`, params: [going], countOnly: true }),
    };
  }
  return out;
}

/** Every number the verification compares, before and after. `going` only with --test-content. */
async function snapshot(db, settingsKeysGoing, going = null) {
  const tables = {};
  for (const p of PLAN) tables[p.table] = await stats(db, p.table, { countOnly: p.verdict === "clear" });
  const snap = {
    tables,
    /* the two we edit a counter on, fingerprinted without the columns that move */
    promoCodesKept: await stats(db, "promo_codes", { cols: await columnsExcept(db, "promo_codes", PROMO_MUTABLE) }),
    newslettersKept: await stats(db, "newsletters", {
      cols: await columnsExcept(db, "newsletters", NEWSLETTER_MUTABLE),
    }),
    /* settings minus the rows we are deliberately deleting by key */
    settingsKept: await stats(db, "settings", { where: settingsWhere(settingsKeysGoing) }),
  };
  if (going) snap.own = await ownProductStats(db, going);
  return snap;
}

/* ---------- --test-content: what it would delete, by name ---------------- */

/** A {RU, ET, EN} jsonb value as one readable string — Russian first, as the owner reads it. */
function pickLang(v) {
  if (v == null) return "";
  if (typeof v === "string") {
    try {
      return pickLang(JSON.parse(v));
    } catch {
      return v;
    }
  }
  if (typeof v !== "object") return String(v);
  for (const k of ["RU", "ET", "EN"]) if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
  return "";
}

let catalogueIdsMemo = null;
/**
 * The imported catalogue's ids (src/data/catalogue.min.json — the file the
 * shop is built from). An own product is recognised by its row in
 * custom_products or by the `c-` prefix; this list is the belt to that brace:
 * an id that is ALSO an imported product is a refusal, because deleting its
 * product_overrides row would silently revert a real price.
 */
export function catalogueIds() {
  if (catalogueIdsMemo) return catalogueIdsMemo;
  const file = new URL("../src/data/catalogue.min.json", import.meta.url);
  const list = JSON.parse(readFileSync(file, "utf8"));
  catalogueIdsMemo = new Set(list.map((p) => String(p.id)));
  return catalogueIdsMemo;
}

/**
 * Everything --test-content deletes, each by the name the owner knows it by —
 * so on the night he approves a list, not a number.
 *
 * Own products are every custom_products row (the admin cannot hard-delete
 * one — «Снять с продажи» only hides it) plus any `c-…` id that has
 * product_overrides or stock rows with no product row behind it any more
 * (left-overs; nothing can show them, and nothing but this tool would ever
 * delete them). Minus the ids --keep-product names.
 */
export async function testContentLook(db, keep = []) {
  const keepSet = new Set(keep);
  const promos = (
    await rows(
      db,
      `select code, kind, value::text as value, used::int as used, active, note from promo_codes order by code`,
    )
  ).map((r) => ({
    code: String(r.code),
    kind: String(r.kind),
    value: String(r.value),
    used: Number(r.used || 0),
    active: r.active === true || r.active === "t",
    note: r.note == null ? "" : String(r.note),
  }));
  const sets = (await rows(db, "select id, name_ru, active from bundles order by sort, id")).map((r) => ({
    id: String(r.id),
    name: r.name_ru == null ? "" : String(r.name_ru),
    active: r.active === true || r.active === "t",
  }));
  const posts = (
    await rows(
      db,
      `select slug, title, status, (deleted_at is not null) as deleted
         from posts order by coalesce(published_at, created_at), slug`,
    )
  ).map((r) => ({
    slug: String(r.slug),
    title: pickLang(r.title),
    status: String(r.status),
    deleted: r.deleted === true || r.deleted === "t",
  }));
  const letters = (await rows(db, "select title, subject, status from newsletters order by created_at, id")).map((r) => ({
    title: r.title == null ? "" : String(r.title),
    subject: pickLang(r.subject),
    status: String(r.status),
  }));
  const candidates = (
    await rows(
      db,
      `select p.id, c.brand, c.name, c.active, (c.id is null) as orphan
         from (select id from custom_products
               union select product_id from product_overrides where product_id like 'c-%'
               union select product_id from stock_levels where product_id like 'c-%'
               union select product_id from stock_moves where product_id like 'c-%') as p
         left join custom_products c on c.id = p.id
        order by p.id`,
    )
  ).map((r) => ({
    id: String(r.id),
    brand: r.brand == null ? "" : String(r.brand),
    name: r.name == null ? "" : String(r.name),
    active: r.active === true || r.active === "t",
    orphan: r.orphan === true || r.orphan === "t",
  }));
  const products = candidates.filter((p) => !keepSet.has(p.id));
  const kept = candidates.filter((p) => keepSet.has(p.id));
  const going = products.map((p) => p.id);
  const n = async (sql) => Number((await one(db, sql, [going])).n || 0);
  const rowsGoing = {
    product_overrides: await n("select count(*)::int as n from product_overrides where product_id = any($1::text[])"),
    stock_levels: await n("select count(*)::int as n from stock_levels where product_id = any($1::text[])"),
    stock_moves: await n("select count(*)::int as n from stock_moves where product_id = any($1::text[])"),
  };
  const eans = await n("select count(*)::int as n from stock_levels where product_id = any($1::text[]) and ean is not null");

  const problems = [];
  for (const k of keep) {
    if (!candidates.some((p) => p.id === k && !p.orphan)) {
      problems.push(
        `--keep-product ${k}: there is no own product with that id. Check the spelling against the list the dry ` +
          "run prints; imported products are never deleted and need no flag.",
      );
    }
  }
  let catalogue = null;
  try {
    catalogue = catalogueIds();
  } catch (err) {
    problems.push(`cannot read src/data/catalogue.min.json to prove no imported product is on the list (${err.message}).`);
  }
  if (catalogue) {
    for (const id of going) {
      if (catalogue.has(id)) {
        problems.push(
          `${id} is an own product AND an imported one. Deleting it would take an imported product's edits and stock ` +
            "with it; this tool will not. Look at it in the admin, or name it with --keep-product.",
        );
      }
    }
  }
  return { promos, sets, posts, letters, products, kept, going, rows: rowsGoing, eans, problems };
}

/* ---------- what the database can tell us before anything happens -------- */

async function one(db, sql, params) {
  const r = await rows(db, sql, params);
  return r[0] || {};
}

/** Where order numbering began (db/migrations/001_core.sql) and the floor it never goes under. */
export const FIRST_ORDER_NUMBER = 100001;

/**
 * The number the first order after the clear will get — and the proof of it.
 *
 * Until 27.09.2026 the clear restarted order_number_seq at 100001. That was
 * harmless while every order had gone to the Montonio SANDBOX; it stopped
 * being harmless on 26.09.2026, when the live hour ran on the staging shop
 * with the live keys and R-100095…R-100098 became merchantReferences in the
 * LIVE Montonio account, where the shop's refunds, reports and support look
 * orders up. A restart at 100001 hands out R-100095 a second time a few
 * months later (audit 27.09.2026, G26).
 *
 * So the sequence continues instead: after the highest `R-<n>` in `orders`,
 * and never below the sequence's own next value — a number can have left the
 * building for an order that has since been deleted by hand, and the sequence
 * is the only thing that remembers it. Never below 100001 either.
 *
 * Read INSIDE the clear's transaction and BEFORE its deletes: after them the
 * table is empty and «the highest number» is nothing at all.
 */
export async function nextOrderNumber(db) {
  const hi = await one(
    db,
    `select coalesce(max((substring(number from '^R-([0-9]{1,15})$'))::bigint), 0)::text as n from orders`,
  );
  const seq = await one(db, "select last_value::text as last, is_called from order_number_seq");
  const highest = Number(hi.n || 0);
  const last = Number(seq.last || 0);
  const seqNext = seq.is_called === true || seq.is_called === "t" ? last + 1 : last;
  const next = Math.max(FIRST_ORDER_NUMBER, highest + 1, seqNext);
  if (!Number.isSafeInteger(next)) throw new Error(`go-live-reset: an order number out of range (${next})`);
  return { highest: highest || null, seqNext, next };
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
  const content = Boolean(opts.testContent);
  const clearing = new Set(byVerdict("clear"));
  if (opts.stock) for (const t of STOCK_ORDER) clearing.add(t);
  if (content) for (const t of TEST_CONTENT_TABLES) clearing.add(t);
  const byRow = new Set(content ? OWN_PRODUCT_KEYS.map(([t]) => t).filter((t) => !clearing.has(t)) : []);

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
    /* --test-content: the product-keyed tables lose the own products' rows
       and are checked row by row below, not by size. */
    if (byRow.has(p.table)) continue;
    if (a.n !== b.n) problems.push(`${p.table}: ${b.n} row(s) before, ${a.n} after — a KEEP table must not change size`);
    if (p.table === "promo_codes" || p.table === "newsletters") continue;
    if (a.fp !== b.fp) problems.push(`${p.table}: contents changed (${b.n} rows both sides, different fingerprint)`);
  }

  for (const t of byRow) {
    const b = before.own && before.own[t];
    const a = after.own && after.own[t];
    if (!a || !b) {
      problems.push(`${t}: no row-by-row picture of the own products — --test-content cannot be verified`);
      continue;
    }
    if (a.going.n !== 0) problems.push(`${t}: ${a.going.n} row(s) of the deleted own products are still there`);
    if (a.kept.n !== b.kept.n || a.kept.fp !== b.kept.fp) {
      problems.push(
        `${t}: a row that belongs to no deleted own product changed (${b.kept.n} → ${a.kept.n}) — ` +
          "imported products' edits and stock must come out identical",
      );
    }
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
  /* With --test-content both tables are on the clearing list and proved empty above. */
  if (!content && after.promoCodesKept.fp !== before.promoCodesKept.fp) {
    problems.push("promo_codes: something other than the `used` counter changed");
  }
  if (!content && after.newslettersKept.fp !== before.newslettersKept.fp) {
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
  const testContent = Boolean(opts.testContent);
  const keepProducts = [...new Set((opts.keepProducts || []).map((k) => String(k)))];

  /* Before the database is even read: an id that is not the shape of one
     goes into a pasteable shell line below, and a --keep-product without
     --test-content means the operator thinks something is being deleted that
     is not. Both are a question to ask, not a guess to make. */
  const bad = keepProducts.filter((k) => !KEEP_ID.test(k));
  if (bad.length) throw new ResetRefused(bad.map((k) => `--keep-product «${k}» is not a product id (a-z, 0-9 and «-»).`));
  if (keepProducts.length && !testContent) {
    throw new ResetRefused([
      "--keep-product only means something together with --test-content — without it no own product is deleted at all.",
    ]);
  }

  const schema = await readSchema(db);
  const missing = schemaMissing(schema);
  if (missing.length) throw new ResetRefused(missing); // nothing to count, dry run or not
  const schemaIssues = schemaExtras(schema);
  if (schemaIssues.length && clear) throw new ResetRefused(schemaIssues);

  const settingsKeysGoing = [...SETTINGS_CLEAR_KEYS, ...(testplan ? [SETTINGS_ASK_KEYS.testplan] : [])];
  const content = testContent ? await testContentLook(db, keepProducts) : null;
  const before = await snapshot(db, settingsKeysGoing, content ? content.going : null);
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
    testContent,
    keepProducts,
    /* --test-content's list, by name. Null without the flag. A clear reads it
       again inside its transaction and reports THAT list — what was deleted. */
    content,
    schemaIssues,
    before,
    after: null,
    guard,
    look,
    settingsKeysGoing,
    settingsKeysPresent: settingsPresent,
    /* The dry run's answer; a clear reads it again inside its transaction. */
    orderNumbers: await nextOrderNumber(db),
    changed: { promoCodes: 0, newsletters: 0, sequence: false, invoiceYears: before.tables.invoice_counters.n },
  };

  if (!clear) return report;

  if (content && content.problems.length) throw new ResetRefused(content.problems);

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
    /* The list again, in the transaction's own snapshot: what is deleted is
       what this read says, and the report after the clear names exactly that.
       A product created between the dry run and this line is on it — the
       dry run immediately before the clear is the one to read. */
    let going = null;
    if (testContent) {
      const inTx = await testContentLook(db, keepProducts);
      if (inTx.problems.length) {
        await db.query("rollback");
        throw new ResetRefused(["NOTHING WAS CHANGED — the transaction was rolled back.", ...inTx.problems]);
      }
      report.content = inTx;
      going = inTx.going;
    }
    const beforeTx = await snapshot(db, settingsKeysGoing, going);
    /* Before the deletes, in the same snapshot — see nextOrderNumber(). */
    const numbers = await nextOrderNumber(db);
    report.orderNumbers = numbers;

    for (const t of DELETE_ORDER) await db.query(`delete from ${t}`);
    if (stock) for (const t of STOCK_ORDER) await db.query(`delete from ${t}`);

    /* --test-content. After DELETE_ORDER, so promo_code_uses and
       newsletter_sends — the only rows pointing at these — are already gone
       and no `on delete cascade` has anything to follow. The own products go
       by id, as a parameter: every other row of those tables is an imported
       product's and is verified untouched below. */
    if (testContent) {
      for (const t of TEST_CONTENT_TABLES) await db.query(`delete from ${t}`);
      for (const [t, col] of OWN_PRODUCT_KEYS) await db.query(`delete from ${t} where ${col} = any($1::text[])`, [going]);
    }

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
       rolls back with everything else, unlike setval(). The value is an
       integer this file computed (nextOrderNumber() checks it is safe), never
       text from the database or the command line. It is at least where the
       sequence already was, so this can only ever move the numbering on. */
    const left = await one(db, "select count(*)::int as n from orders");
    if (Number(left.n) === 0) {
      await db.query(`alter sequence order_number_seq restart with ${numbers.next}`);
      report.changed.sequence = true;
    }

    const after = await snapshot(db, settingsKeysGoing, going);
    report.after = after;
    const problems = verify(beforeTx, after, { stock, testContent });
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

/**
 * `launcher` is how the pasteable line at the bottom starts — `node`, or
 * `node --env-file=.env.railway.txt` when that is how this run was started
 * (main() reads it off process.execArgv). The morning's command carries the
 * env file; a line that drops it answers «DATABASE_URL is not set» at the
 * worst possible moment (audit 27.09.2026, G2).
 *
 * @param {any} report
 * @param {{ url?: string, launcher?: string }} [opts]
 */
export function formatReport(report, { url, launcher = "node" } = {}) {
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

  /* With --test-content the rows of these go too; how many, per table, for the → column. */
  const content = report.testContent ? report.content : null;
  const goingRows = (t) => {
    if (!content) return 0;
    if (TEST_CONTENT_TABLES.includes(t)) return report.before.tables[t].n;
    if (t === "custom_products") return content.products.filter((p) => !p.orphan).length;
    return content.rows[t] || 0;
  };

  L.push(`KEEP — the shop, and the records · ${rowsOf("keep").length} tables, ${total("keep")} rows`);
  for (const p of rowsOf("keep")) {
    const b = report.before.tables[p.table].n;
    const g = goingRows(p.table);
    if (content && (p.content || p.table === "product_overrides")) {
      const a = report.after ? report.after.tables[p.table].n : b - g;
      const note = TEST_CONTENT_TABLES.includes(p.table)
        ? "all of them, --test-content — see TEST CONTENT"
        : p.table === "custom_products"
          ? `the own products, --test-content${content.kept.length ? ` — ${content.kept.length} kept by --keep-product` : ""}`
          : "only the own products' rows, --test-content — imported products' edits untouched";
      L.push(`  ${pad(p.table, w)}${padL(b, 7)} → ${a}   ${note}`);
      continue;
    }
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
    const a = report.after ? report.after.tables[p.table].n : report.stock ? 0 : b - goingRows(p.table);
    const note = content && !report.stock && goingRows(p.table) ? "   only the own products' rows, --test-content" : "";
    L.push(`  ${pad(p.table, w)}${padL(b, 7)} → ${a}${note}`);
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

  L.push(...formatTestContent(report));

  L.push("ALSO, in the same transaction");
  if (content) {
    L.push("  promo_codes, newsletters  deleted whole by --test-content — see TEST CONTENT");
  } else {
    L.push(
      `  promo_codes.used      reset to 0 on ${report.after ? `${report.changed.promoCodes} code(s)` : "the codes that have one"} — definitions kept`,
    );
    L.push(
      `  newsletters           ${report.after ? `${report.changed.newsletters} letter(s)` : "any that were sent or sending"} put back to draft — text kept`,
    );
  }
  L.push(`  settings keys removed  ${report.settingsKeysPresent.length ? report.settingsKeysPresent.join(", ") : "(none of them are set)"}`);
  if (!report.testplan) L.push("  settings.testplan_answers  KEPT — the acceptance record. --testplan clears it.");
  const on = report.orderNumbers;
  if (on) {
    const after = on.highest ? `after R-${on.highest}, the highest number handed out so far` : "nothing handed out yet";
    L.push(
      `  order_number_seq      ${report.changed.sequence ? "continues" : "will continue"} at R-${on.next} — ${after};` +
        " never restarted lower, Montonio keeps the old numbers",
    );
  }
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
    const flags = flagsLine({ ...report, giftCardsAreTest: report.guard.blocked });
    L.push("Nothing was changed. To do it for real:");
    L.push(`  ${launcher} tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}"${flags}`);
    if (report.guard.blocked) L.push("  — and only after you have looked at the gift cards above.");
    if (content) L.push("  — and only after the owner has read every name under TEST CONTENT.");
  } else {
    L.push(
      content
        ? "Done, in one transaction. Everything the flags did not name was verified unchanged before the commit — " +
            "imported products' edits and stock row by row."
        : "Done, in one transaction, with every KEEP table verified unchanged before the commit.",
    );
  }
  return L.join("\n");
}

/**
 * The flags a pasteable line carries, in one fixed order. `opts` is the
 * parsed arguments or a report — both spell them the same way. Keep ids were
 * checked against KEEP_ID before they got here: nothing a shell would read.
 */
export function flagsLine(opts) {
  return (
    (opts.stock ? " --stock" : "") +
    (opts.testplan ? " --testplan" : "") +
    (opts.testContent ? " --test-content" : "") +
    (opts.keepProducts || []).map((k) => ` --keep-product ${k}`).join("") +
    (opts.giftCardsAreTest ? " --gift-cards-are-test-cards" : "")
  );
}

/**
 * The TEST CONTENT block. With the flag: every promo code, set, post,
 * newsletter and own product by name — the list the owner approves on the
 * night. Without it: one line of counts, and how to see the names.
 */
export function formatTestContent(report) {
  const L = [];
  const t = report.before.tables;
  if (!report.testContent || !report.content) {
    L.push(
      `TEST CONTENT — not touched without --test-content · ${t.promo_codes.n} promo code(s), ${t.bundles.n} set(s), ` +
        `${t.posts.n} blog post(s), ${t.newsletters.n} newsletter(s), ${t.custom_products.n} own product(s)`,
    );
    L.push("  Run the dry run with --test-content to see every one of them by name.");
    L.push("");
    return L;
  }
  const c = report.content;
  const dry = report.mode === "dry";
  const q = (s) => (s ? `«${s}»` : "(no name)");
  /* One column per list, as wide as its longest id plus two — a 44-letter
     product id must not run into its own name. */
  const col = (xs) => Math.max(0, ...xs.map((x) => x.length)) + 2;
  L.push(
    dry
      ? "TEST CONTENT — deleted too, because --test-content was given (the owner's decision, 28.09.2026)"
      : "TEST CONTENT — deleted, because --test-content was given",
  );
  L.push(`  promo codes · ${c.promos.length}`);
  const wc = col(c.promos.map((p) => p.code));
  for (const p of c.promos) {
    const v = p.kind === "percent" ? `${Number(p.value)} %` : `${p.value} EUR`;
    L.push(`      ${pad(p.code, wc)}${v}, used ${p.used}${p.active ? "" : ", off"}${p.note ? `  — ${p.note}` : ""}`);
  }
  L.push(`  sets · ${c.sets.length}`);
  const ws = col(c.sets.map((s) => s.id));
  for (const s of c.sets) L.push(`      ${pad(s.id, ws)}${q(s.name)}${s.active ? "" : "  (off)"}`);
  L.push(`  blog posts · ${c.posts.length}`);
  const wp = col(c.posts.map((p) => p.slug));
  for (const p of c.posts) {
    const state = p.deleted ? "in the bin" : p.status === "published" ? "published" : p.status;
    L.push(`      ${pad(p.slug, wp)}${q(p.title)}  (${state})`);
  }
  L.push(`  newsletters · ${c.letters.length}`);
  for (const n of c.letters) L.push(`      ${q(n.subject)}  (${n.status}${n.title ? `; in the panel: ${n.title}` : ""})`);
  const own = c.products.filter((p) => !p.orphan);
  const orphans = c.products.filter((p) => p.orphan);
  L.push(
    `  own products · ${own.length} — with their ${c.rows.product_overrides} product edit row(s), ` +
      `${c.rows.stock_levels} stock row(s)${c.eans ? ` (${c.eans} with a barcode)` : ""}, ${c.rows.stock_moves} stock move(s)`,
  );
  const wo = col([...own, ...c.kept].map((p) => p.id));
  for (const p of own) {
    const name = [p.brand, p.name].filter(Boolean).join(" — ");
    L.push(`      ${pad(p.id, wo)}${name}${p.active ? "" : "  (off sale)"}`);
  }
  if (orphans.length) {
    L.push(`  left-over rows of own products that no longer exist · ${orphans.length}`);
    for (const p of orphans) L.push(`      ${p.id}`);
  }
  if (c.kept.length) {
    L.push(`  KEPT by --keep-product · ${c.kept.length}`);
    for (const p of c.kept) L.push(`      ${pad(p.id, wo)}${[p.brand, p.name].filter(Boolean).join(" — ")}`);
  } else {
    L.push("  kept by --keep-product: none. A real own product Renat made is kept with --keep-product <id>.");
  }
  for (const p of c.problems) L.push(`  ! ${p}`);
  L.push("  Stays: every imported product with its prices and edits, settings, letter texts, delivery prices,");
  L.push(
    report.stock
      ? "  the bank list. (The whole stock goes too, but that is --stock — see STOCK above.)"
      : "  the bank list, and the stock and barcodes of imported products.",
  );
  L.push("");
  return L;
}

/* ---------- CLI ---------------------------------------------------------- */

function parseArgs(argv) {
  const out = {
    clear: false,
    stock: false,
    testplan: false,
    giftCardsAreTest: false,
    testContent: false,
    keepProducts: [],
    confirm: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clear") out.clear = true;
    else if (a === "--stock") out.stock = true;
    else if (a === "--testplan") out.testplan = true;
    else if (a === "--gift-cards-are-test-cards") out.giftCardsAreTest = true;
    else if (a === "--test-content") out.testContent = true;
    else if (a === "--keep-product") out.keepProducts.push(argv[++i] ?? "");
    else if (a.startsWith("--keep-product=")) out.keepProducts.push(a.slice("--keep-product=".length));
    else if (a === "--confirm") out.confirm = argv[++i] ?? "";
    else if (a.startsWith("--confirm=")) out.confirm = a.slice("--confirm=".length);
    else if (a === "--help" || a === "-h") out.help = true;
    else out.unknown = a;
  }
  return out;
}

const USAGE = `go-live-reset — remove the staging test data before the shop opens.

  node --env-file=.env.railway.txt tools/go-live-reset.mjs                          dry run: prints, changes nothing
  node --env-file=.env.railway.txt tools/go-live-reset.mjs --clear --confirm "…"    clears, in one transaction

  .env.railway.txt holds DATABASE_URL=<Railway's DATABASE_PUBLIC_URL> and, on a
  second line, DATABASE_SSL_NO_VERIFY=1 (Railway signs its certificate with a
  private CA) — or DATABASE_SSL_CA with that CA. docs/go-live-reset.md, step 1.

  --test-content                 also delete every promo code, set, blog post and newsletter, and every own
                                 product (c-…) with its edits and stock rows — ON launch day (28.09.2026).
                                 The dry run with it lists every one by name.
  --keep-product <id>            with --test-content: keep this own product (repeat for more than one)
  --stock                        also clear stock_levels AND stock_moves (never one alone), barcodes included —
                                 ON launch day (28.09.2026: every count and barcode on staging is a test;
                                 tools/import-shopify-stock.mjs writes the real counts right after)
  --testplan                     also clear settings.testplan_answers
  --gift-cards-are-test-cards    proceed past the gift-card liability check
  DB_DRIVER=pglite               run against an empty in-memory Postgres instead

Read docs/go-live-reset.md first. Its first step is the database copy (tools/db-backup.mjs).`;

/**
 * How this run was started, for the pasteable line: `node` plus any
 * --env-file the operator gave node itself. Only --env-file is carried over;
 * nothing else from execArgv is worth repeating, and nothing here is secret —
 * it is a file NAME, never its contents.
 */
export function launcherFrom(execArgv = []) {
  const out = ["node"];
  for (let i = 0; i < execArgv.length; i++) {
    const a = String(execArgv[i]);
    if (/^--env-file(-if-exists)?=/.test(a)) out.push(a);
    else if ((a === "--env-file" || a === "--env-file-if-exists") && execArgv[i + 1]) out.push(`${a}=${execArgv[++i]}`);
  }
  return out.join(" ");
}

/* The errors node-postgres gives when the server's certificate chain ends in a
   CA Node does not trust — Railway's own, every time (docs/backend.md). */
const TLS_UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

async function connect() {
  if (process.env.DB_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    await migrate(db);
    return { db, close: () => db.close(), url: "" };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Start the tool with the file from docs/go-live-reset.md, step 1:\n" +
        "  node --env-file=.env.railway.txt tools/go-live-reset.mjs\n" +
        "(or run with DB_DRIVER=pglite for an empty in-memory database).",
    );
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
  } catch (err) {
    if (err && TLS_UNTRUSTED.has(err.code)) {
      console.error(
        `Could not verify the database's certificate (${err.code}). Railway signs it with its own CA.\n` +
          "Add one line to .env.railway.txt — DATABASE_SSL_NO_VERIFY=1 — or DATABASE_SSL_CA with Railway's CA,\n" +
          "and run the same command again. Nothing was changed.",
      );
      process.exit(1);
    }
    throw err;
  }
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
  if (args.keepProducts.some((k) => !KEEP_ID.test(k))) {
    console.error("--keep-product needs an own product's id after it (a-z, 0-9 and «-»), e.g. --keep-product c-rempire-hoodie");
    process.exit(2);
  }
  const launcher = launcherFrom(process.execArgv);
  if (args.clear && args.confirm !== CONFIRM_PHRASE) {
    console.error(
      "--clear needs the confirmation, spelled exactly. Paste this line:\n\n" +
        `  ${launcher} tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}"` +
        flagsLine(args) +
        "\n\nAnd take the database copy first — docs/go-live-reset.md, step 1.",
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
    console.log(formatReport(report, { url, launcher }));
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
