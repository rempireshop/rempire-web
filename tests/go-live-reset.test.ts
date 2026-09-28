/**
 * tools/go-live-reset.mjs — the go-live clean-up, proved against a database
 * that looks like the shop did after four months of staging.
 *
 * There is no production database to try this on, and there would never be one
 * to try it on twice, so the seed below IS the test: orders in three statuses,
 * a customer who ticked the marketing box, a guest who pressed «Отписаться», a
 * gift card bought by a paid order, promo codes used up to their cap, a
 * newsletter that went out, a shelf that was counted and then sold from — and
 * beside all of it the things Renat spent weeks on: prices, tariffs, letter
 * texts, blog posts, bundles. Then run it and look at what is left.
 *
 * The test that will still be doing work in a year is «the plan names every
 * table the migrations create». A migration that adds a table without adding a
 * line to PLAN fails here, which is the only thing that keeps this file honest
 * once everyone who wrote it has forgotten it exists.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import {
  CONFIRM_PHRASE,
  DELETE_ORDER,
  OWN_PRODUCT_KEYS,
  PLAN,
  ResetRefused,
  STOCK_ORDER,
  TEST_CONTENT_TABLES,
  byVerdict,
  catalogueIds,
  flagsLine,
  formatReport,
  goLiveReset,
  launcherFrom,
  maskUrl,
  schemaMissing,
  schemaProblems,
  verify,
} from "../tools/go-live-reset.mjs";
import { setupDb, teardownDb } from "./helpers";

/* ---------- types the .mjs does not carry -------------------------------- */

type Stats = { n: number; fp: string };
type Snapshot = {
  tables: Record<string, Stats>;
  promoCodesKept: Stats;
  newslettersKept: Stats;
  settingsKept: Stats;
  own?: Record<string, { kept: Stats; going: Stats }>;
};
type Money = { n: number; total: number };
type OwnProduct = { id: string; brand: string; name: string; active: boolean; orphan: boolean };
type Content = {
  promos: Array<{ code: string; kind: string; value: string; used: number; active: boolean; note: string }>;
  sets: Array<{ id: string; name: string; active: boolean }>;
  posts: Array<{ slug: string; title: string; status: string; deleted: boolean }>;
  letters: Array<{ title: string; subject: string; status: string }>;
  products: OwnProduct[];
  kept: OwnProduct[];
  going: string[];
  rows: { product_overrides: number; stock_levels: number; stock_moves: number };
  eans: number;
  problems: string[];
};
type Report = {
  mode: "dry" | "clear";
  testContent: boolean;
  keepProducts: string[];
  content: Content | null;
  schemaIssues: string[];
  before: Snapshot;
  after: Snapshot | null;
  guard: { live: Money; paid: Money; orphan: Money; blocked: boolean };
  look: {
    consents: Array<{ email: string; source: string; at: string }>;
    quiet: Array<{ email: string; at: string }>;
    quietTotal: number;
    alerts: string[];
    approvedReviews: number;
    stockMoves: Array<{ reason: string; n: number }>;
    invoicedOrders: number;
    boundEans: number;
  };
  settingsKeysPresent: string[];
  orderNumbers: { highest: number | null; seqNext: number; next: number };
  changed: { promoCodes: number; newsletters: number; sequence: boolean; invoiceYears: number };
};
type PlanRow = { table: string; verdict: string; why: string; never?: boolean };

const plan = PLAN as unknown as PlanRow[];
const clearList = byVerdict("clear") as unknown as string[];
const askList = byVerdict("ask") as unknown as string[];
const deleteOrder = DELETE_ORDER as unknown as string[];
const stockOrder = STOCK_ORDER as unknown as string[];

/** The thin adapter the tool takes: `{ rows }` from a query, `exec` for batches. */
const db = {
  query: async (sql: string, params?: unknown[]) => ({ rows: await query(sql, params) }),
  exec,
};

const run = (opts: Record<string, unknown>) => goLiveReset(db, opts) as unknown as Promise<Report>;

/** Asserts that the tool refused, and hands back what it said. */
async function refusal(opts: Record<string, unknown>): Promise<string> {
  try {
    await run(opts);
  } catch (err) {
    if (err instanceof ResetRefused) return (err.problems as string[]).join(" | ");
    throw err;
  }
  throw new Error("expected go-live-reset to refuse, and it did not");
}

const ALL_TABLES = plan.map((p) => p.table).filter((t) => t !== "_migrations");

async function count(table: string): Promise<number> {
  const r = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return Number(r[0].n);
}

/** The number the next order really gets — through the column default, as the checkout does. */
async function newOrderNumber(): Promise<string> {
  const r = await query<{ number: string }>(
    "insert into orders (status, items, subtotal, total) values ('new', '[]'::jsonb, 0, 0) returning number",
  );
  return r[0].number;
}

/* ---------- a shop that has been staging for four months ----------------- */

async function seedUsedShop(): Promise<void> {
  /* --- the shop itself: what Renat typed, and what the migrations seeded -- */
  await query(
    `insert into settings (key, value) values
       ('shipping_rules', $1::jsonb), ('pricing', $2::jsonb), ('mail_texts', $3::jsonb),
       ('content', $4::jsonb), ('flows', $5::jsonb), ('flow_runs', $6::jsonb),
       ('testplan_answers', $7::jsonb), ('shipping_statuses', $8::jsonb)`,
    [
      JSON.stringify({ freeFrom: 59, methods: { parcel: { EE: 5.47 } } }),
      JSON.stringify({ loyalty: 3, proDiscountPct: 20 }),
      JSON.stringify({ order_paid: { RU: { subject: "Спасибо за заказ" } } }),
      JSON.stringify({ contact: { phone: "+372 5555 5555" } }),
      JSON.stringify({ abandoned: true, birthday: true, unpaid: true, unpaidFrom: "2026-09-01" }),
      JSON.stringify({ abandoned: { at: "2026-09-10T07:00:00.000Z", sent: 1, by: "cron" } }),
      JSON.stringify({ "cart-1": { ok: true, at: "2026-09-12T10:00:00.000Z", by: "renat" } }),
      JSON.stringify({ delivered: { count: 4, meaning: "delivered" } }),
    ],
  );
  await query(
    "insert into product_overrides (product_id, price, stock, seo_title) values ('touchable', 21.50, 'in', 'Touchable 250 мл')",
  );
  await query("insert into custom_products (id, brand, name, cat) values ('salon-towel', 'Rempire', 'Полотенце', 'other')");
  await query("insert into bundles (id, cat, name_ru, items) values ('care-duo', 'body', 'Дуэт ухода', '[]'::jsonb)");
  await query("insert into posts (slug, status, title, body) values ('kak-myt-golovu', 'published', $1::jsonb, $2::jsonb)", [
    JSON.stringify({ RU: "Как мыть голову" }),
    JSON.stringify({ RU: "Текст статьи" }),
  ]);
  await query(
    `insert into promo_codes (code, kind, value, max_uses, used, note) values
       ('WELCOME10', 'percent', 10, 100, 7, 'для новых'),
       ('TEST5', 'fixed', 5, 5, 5, 'проба')`,
  );

  /* --- the stop list: two people who pressed «Отписаться» ----------------- */
  await query(
    `insert into mail_optouts (email, kind, source) values
       ('opted.out@example.com', 'marketing', 'link'),
       ('one.click@example.com', 'marketing', 'one-click')`,
  );

  /* --- the audit trail, including the rows the login ladder counts -------- */
  await query(
    `insert into admin_audit (actor, action, payload) values
       ('ip:1.2.3.4', 'admin.login.failed', '{}'::jsonb),
       ('ip:1.2.3.4', 'admin.login.failed', '{}'::jsonb),
       ('dim', 'admin.login', '{}'::jsonb),
       ('dim', 'settings.save', '{"key":"shipping_rules"}'::jsonb)`,
  );

  /* --- customers, one of whom ticked the marketing box -------------------- */
  const cust = await query<{ id: string }>(
    `insert into customers (email, name, marketing, marketing_at, marketing_source, birthday_sent_year)
     values ('renat.test@example.com', 'Ренат (тест)', true, now(), 'checkout', 2026) returning id`,
  );
  await query("insert into customers (email, name, marketing) values ('guest.test@example.com', 'Гость', false)");
  const customer = String(cust[0].id);

  /* --- months of orders --------------------------------------------------- */
  /* The sequence where months of staging left it, set BEFORE the orders so
     they are R-100042…R-100044 in every test — the sequence is not owned by a
     column, so the truncate's `restart identity` never resets it and the
     numbers would otherwise depend on how many tests ran first. */
  await exec("alter sequence order_number_seq restart with 100042");
  const mk = async (status: string, total: number, invoiceNo: string | null) => {
    const r = await query<{ id: string }>(
      `insert into orders (status, email, name, items, subtotal, total, customer_id, invoice)
       values ($1, 'renat.test@example.com', 'Ренат (тест)', '[]'::jsonb, $2, $2, $3, $4::jsonb) returning id`,
      [status, total, customer, invoiceNo ? JSON.stringify({ number: invoiceNo, issuedAt: "2026-09-01" }) : null],
    );
    return String(r[0].id);
  };
  const paidOrder = await mk("paid", 49.9, "2026-0001");
  const newOrder = await mk("new", 12, null);
  await mk("refunded", 30, "2026-0002");
  await query("insert into order_messages (order_id, direction, body) values ($1, 'out', 'Заказ отправлен')", [paidOrder]);
  await query("insert into invoice_counters (year, last) values (2026, 2)");

  /* --- a gift card the paid order bought, part-spent --------------------- */
  await query(
    "insert into gift_cards (code, amount, balance, order_id, recipient) values ('RMP-TEST-0001', 50, 20, $1, '{\"name\":\"Тест\"}'::jsonb)",
    [paidOrder],
  );
  await query("insert into gift_card_uses (code, order_id, amount, kind) values ('RMP-TEST-0001', $1, 30, 'redeem')", [
    newOrder,
  ]);

  /* --- promo uses, loyalty, carts, alerts, reviews, events ---------------- */
  await query("insert into promo_code_uses (code, order_id, amount) values ('WELCOME10', $1, 4.99)", [paidOrder]);
  await query("insert into promo_code_uses (code, order_id, amount) values ('TEST5', $1, 5)", [newOrder]);
  await query("insert into loyalty_ledger (customer_id, delta, reason, order_id) values ($1, 150, 'earn', $2)", [
    customer,
    paidOrder,
  ]);
  await query("insert into carts (email, items, total, reminded_at) values ('cart.test@example.com', '[]'::jsonb, 30, now())");
  await query("insert into cart_writes (email, day, n) values ('cart.test@example.com', '2026-09-17', 4)");
  await query("insert into cart_returns default values");
  // an alert the owner already got about a test order (217_owner_alerts.sql)
  await query("insert into owner_alerts (key, kind, number, delivered) values ('payment_recovered:R-100001', 'payment_recovered', 'R-100001', true)");
  await query(
    "insert into login_codes (email, code_hash, expires_at) values ('renat.test@example.com', 'deadbeef', now() + interval '10 minutes')",
  );
  await query("insert into stock_alerts (email, product_id) values ('wants@example.com', 'touchable')");
  await query(
    `insert into reviews (product_id, name, rating, text, status) values
       ('touchable', 'Тест', 5, 'Отличный товар', 'approved'),
       ('touchable', 'Тест 2', 4, 'Нормально', 'pending')`,
  );
  await query("insert into events (sid, type, path, lang) values ('s1', 'view', '/', 'RU'), ('s1', 'purchase', '/checkout', 'RU')");
  await query(
    `insert into idempotency_keys (key, route, state, status, response, finished_at)
     values ('order-key-000001', 'POST /api/orders', 'done', 200, '{"ok":true}'::jsonb, now())`,
  );

  /* --- a newsletter that went out to the test addresses ------------------- */
  const nl = await query<{ id: string }>(
    `insert into newsletters (status, title, subject, body, sent_at, sent_count, audience_count)
     values ('sent', 'Осенняя рассылка', $1::jsonb, $2::jsonb, now(), 2, 2) returning id`,
    [JSON.stringify({ RU: "Скидки осени" }), JSON.stringify({ RU: "<p>Текст</p>" })],
  );
  await query(
    `insert into newsletter_sends (newsletter_id, email, status, message_id, sent_at) values
       ($1, 'renat.test@example.com', 'sent', 'resend-1', now()),
       ($1, 'guest.test@example.com', 'sent', 'resend-2', now())`,
    [String(nl[0].id)],
  );

  /* --- a shelf that was counted, and then sold from ----------------------- */
  await query("insert into stock_levels (product_id, variant, qty, ean) values ('touchable', '250 мл', 11, '4601234567890')");
  await query(
    `insert into stock_moves (product_id, variant, delta, reason, ref, actor) values
       ('touchable', '250 мл', 12, 'goods_in', 'приход 01.09', 'admin'),
       ('touchable', '250 мл', -1, 'sale_web', 'R-100042', 'web')`,
  );
}

/** What the owner types on the morning, plus the answer to the gift-card check. */
const CLEAR_OK = { clear: true, confirm: CONFIRM_PHRASE, giftCardsAreTest: true };

beforeAll(async () => {
  await setupDb();
});
afterAll(teardownDb);

beforeEach(async () => {
  await exec(`truncate ${ALL_TABLES.join(", ")} restart identity cascade`);
  await seedUsedShop();
});

/* ---------- the plan itself ---------------------------------------------- */

describe("the plan", () => {
  it("names every table the migrations create, and nothing else", async () => {
    const rows = await query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    /* Failing here means a migration added or dropped a table and nobody said
       what it is for. Add the line to PLAN in tools/go-live-reset.mjs — do not
       "fix" it in this file. */
    expect(schemaProblems(rows.map((r) => r.table_name))).toEqual([]);
  });

  it("gives every table a verdict and an argument", () => {
    expect(plan.length).toBe(31 + 1); // 31 tables from db/migrations (213 added cart_returns, 217 owner_alerts), plus _migrations
    for (const p of plan) {
      expect(["clear", "keep", "ask"]).toContain(p.verdict);
      expect(p.why.length).toBeGreaterThan(60);
    }
  });

  it("deletes exactly the clear-list, children before parents", () => {
    expect([...deleteOrder].sort()).toEqual([...clearList].sort());
    const at = (t: string) => deleteOrder.indexOf(t);
    expect(at("order_messages")).toBeLessThan(at("orders"));
    expect(at("gift_card_uses")).toBeLessThan(at("gift_cards"));
    expect(at("loyalty_ledger")).toBeLessThan(at("customers"));
    expect(at("orders")).toBeLessThan(at("customers"));
  });

  it("keeps the two stock tables together and nowhere else", () => {
    expect([...stockOrder].sort()).toEqual([...askList].sort());
    for (const t of stockOrder) expect(deleteOrder).not.toContain(t);
  });

  it("marks the three that no flag may ever clear", () => {
    const never = plan.filter((p) => p.never).map((p) => p.table);
    expect([...never].sort()).toEqual(["_migrations", "admin_audit", "mail_optouts"]);
    for (const t of never) {
      expect(deleteOrder).not.toContain(t);
      expect(stockOrder).not.toContain(t);
    }
  });
});

/* ---------- dry run ------------------------------------------------------ */

describe("dry run", () => {
  it("changes nothing at all", async () => {
    const before: Record<string, number> = {};
    for (const t of ALL_TABLES) before[t] = await count(t);

    const report = await run({});
    expect(report.mode).toBe("dry");
    expect(report.after).toBeNull();

    for (const t of ALL_TABLES) expect(await count(t)).toBe(before[t]);
  });

  it("prints the row counts it would change, table by table", async () => {
    const text = formatReport(await run({}), { url: "postgres://u:secret@db.railway.internal:5432/railway" });

    expect(text).toContain("DRY RUN. Nothing below has happened.");
    expect(text).toContain("db.railway.internal:5432/railway");
    expect(text).not.toContain("secret");
    expect(text).toMatch(/orders\s+3 → 0/);
    expect(text).toMatch(/customers\s+2 → 0/);
    expect(text).toMatch(/mail_optouts\s+2\s+untouched\s+never cleared, by any flag/);
    expect(text).toMatch(/admin_audit\s+4\s+untouched\s+never cleared, by any flag/);
    expect(text).toMatch(/stock_levels\s+1 → 1/);
    expect(text).toContain("Nothing was changed. To do it for real:");
    /* the line is pasteable as it stands: the confirmation AND the flag this
       run already showed it needs */
    expect(text).toContain(`--confirm "${CONFIRM_PHRASE}" --gift-cards-are-test-cards`);
  });

  it("carries the flags already given into the pasteable command", async () => {
    const text = formatReport(await run({ stock: true, testplan: true }), {});
    expect(text).toContain(`--confirm "${CONFIRM_PHRASE}" --stock --testplan --gift-cards-are-test-cards`);
    expect(text).toContain("STOCK — clearing, because --stock was given");
  });

  it("keeps the env file the run was started with in the pasteable command", async () => {
    /* The morning's command is `node --env-file=.env.railway.txt …`; a
       pasteable line without it answers «DATABASE_URL is not set» (G2). */
    const launcher = launcherFrom(["--env-file=.env.railway.txt"]);
    expect(launcher).toBe("node --env-file=.env.railway.txt");
    const text = formatReport(await run({}), { launcher });
    expect(text).toContain(`  node --env-file=.env.railway.txt tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}"`);
    // the two-argument spelling, and nothing else from node's own flags
    expect(launcherFrom(["--no-warnings", "--env-file", ".env.railway.txt"])).toBe("node --env-file=.env.railway.txt");
    expect(launcherFrom([])).toBe("node");
  });

  it("shows the owner what only he can judge", async () => {
    const report = await run({});
    expect(report.look.approvedReviews).toBe(1);
    expect(report.look.invoicedOrders).toBe(2);
    expect(report.look.consents.map((c) => c.email)).toEqual(["renat.test@example.com"]);
    expect(report.look.consents[0].source).toBe("checkout");

    const text = formatReport(report, {});
    expect(text).toContain("renat.test@example.com");
    expect(text).toContain("mail_optouts is NOT touched");
    expect(text).toContain("goods_in 1");
    expect(text).toContain("sale_web 1");
  });

  it("names the people it deletes who never gave consent, not only the ones who did", async () => {
    /* The consent list answers «whose permission am I throwing away». This
       answers «who am I deleting», and it is the bigger set: the owner's own
       rule for the Shopify import is that a customer arrives with NO marketing
       consent, which is not opted out. Before 19.09.2026 the dry run selected
       `marketing = true` and nothing else, so a real account with no consent
       went silently (audit F47). */
    const report = await run({});
    expect(report.look.quiet.map((c) => c.email)).toContain("guest.test@example.com");
    expect(report.look.quietTotal).toBeGreaterThanOrEqual(1);
    expect(report.look.consents.map((c) => c.email)).not.toContain("guest.test@example.com");

    const text = formatReport(report, {});
    expect(text).toContain("customers WITHOUT marketing consent, also deleted");
    expect(text).toContain("guest.test@example.com");
  });

  it("warns that --stock takes the hand-scanned barcodes with it", async () => {
    const report = await run({});
    expect(report.look.boundEans).toBe(1);
    expect(formatReport(report, {})).toContain("1 barcode(s) are bound to a stock row");
  });

  it("never prints the password", () => {
    expect(maskUrl("postgres://user:hunter2@db.railway.internal:5432/railway")).toBe("db.railway.internal:5432/railway");
    expect(maskUrl("postgres://user:hunter2@host/db")).not.toContain("hunter2");
  });
});

/* ---------- the clear ---------------------------------------------------- */

describe("the clear", () => {
  it("empties every table on the clear list", async () => {
    await run(CLEAR_OK);
    for (const t of clearList) expect(await count(t)).toBe(0);
  });

  it("leaves the shop exactly as it was", async () => {
    const shipping = await query("select value from settings where key = 'shipping_rules'");
    await run(CLEAR_OK);

    expect(await count("settings")).toBe(7); // eight, minus flow_runs
    expect(await query("select value from settings where key = 'shipping_rules'")).toEqual(shipping);
    expect(await count("product_overrides")).toBe(1);
    expect(await count("custom_products")).toBe(1);
    expect(await count("bundles")).toBe(1);
    expect(await count("posts")).toBe(1);
    expect(await count("promo_codes")).toBe(2);
    expect(await count("newsletters")).toBe(1);

    const post = await query<{ title: unknown }>("select title from posts where slug = 'kak-myt-golovu'");
    expect(post[0].title).toEqual({ RU: "Как мыть голову" });
  });

  it("does not touch the stop list", async () => {
    await run(CLEAR_OK);
    const rows = await query<{ email: string; kind: string; source: string }>(
      "select email, kind, source from mail_optouts order by email",
    );
    expect(rows).toEqual([
      { email: "one.click@example.com", kind: "marketing", source: "one-click" },
      { email: "opted.out@example.com", kind: "marketing", source: "link" },
    ]);
  });

  it("keeps the audit trail the login ladder counts off", async () => {
    await run(CLEAR_OK);
    const rows = await query<{ action: string; n: number }>(
      "select action, count(*)::int as n from admin_audit group by action order by action",
    );
    expect(rows).toEqual([
      { action: "admin.login", n: 1 },
      { action: "admin.login.failed", n: 2 },
      { action: "settings.save", n: 1 },
    ]);
  });

  it("resets the promo counter without touching the codes", async () => {
    /* `scope` arrived with 170_promo_scope.sql, after the first draft of the
       tool. The fingerprint reads its column list out of information_schema,
       so a column added later is covered without anybody remembering to. */
    await query("update promo_codes set scope = 'product', scope_value = 'touchable' where code = 'WELCOME10'");
    const report = await run(CLEAR_OK);
    expect(report.changed.promoCodes).toBe(2);
    const scoped = await query<{ scope: string; scope_value: string }>(
      "select scope, scope_value from promo_codes where code = 'WELCOME10'",
    );
    expect(scoped[0]).toEqual({ scope: "product", scope_value: "touchable" });
    const rows = await query<{ code: string; used: number; value: string; max_uses: number; note: string }>(
      `select code, used::int as used, value::text as value, max_uses::int as max_uses, note
         from promo_codes order by code`,
    );
    expect(rows).toEqual([
      { code: "TEST5", used: 0, value: "5.00", max_uses: 5, note: "проба" },
      { code: "WELCOME10", used: 0, value: "10.00", max_uses: 100, note: "для новых" },
    ]);
  });

  it("puts the newsletter back to draft and keeps its text", async () => {
    const report = await run(CLEAR_OK);
    expect(report.changed.newsletters).toBe(1);
    const rows = await query<{
      status: string;
      title: string;
      subject: unknown;
      sent_count: number;
      audience_count: number;
      sent_at: unknown;
      sending_at: unknown;
    }>(
      `select status, title, subject, sent_count::int as sent_count, audience_count::int as audience_count,
              sent_at, sending_at from newsletters`,
    );
    expect(rows[0].status).toBe("draft");
    expect(rows[0].title).toBe("Осенняя рассылка");
    expect(rows[0].subject).toEqual({ RU: "Скидки осени" });
    expect(rows[0].sent_count).toBe(0);
    expect(rows[0].audience_count).toBe(0);
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].sending_at).toBeNull();
    expect(await count("newsletter_sends")).toBe(0);
  });

  it("removes flow_runs and keeps the acceptance answers", async () => {
    const report = await run(CLEAR_OK);
    expect(report.settingsKeysPresent).toEqual(["flow_runs"]);
    const keys = (await query<{ key: string }>("select key from settings order by key")).map((r) => r.key);
    expect(keys).not.toContain("flow_runs");
    expect(keys).toContain("testplan_answers");
    expect(keys).toContain("shipping_statuses");
  });

  it("clears the acceptance answers when asked, and only then", async () => {
    await run({ ...CLEAR_OK, testplan: true });
    const keys = (await query<{ key: string }>("select key from settings order by key")).map((r) => r.key);
    expect(keys).not.toContain("testplan_answers");
    expect(keys).toContain("shipping_rules");
    expect(await count("settings")).toBe(6);
  });

  it("starts the invoice numbers again but CONTINUES the order numbers after the highest one", async () => {
    /* Until 27.09.2026 this asserted R-100001. The live hour of 26.09.2026 put
       R-100095…R-100098 into the LIVE Montonio account, where an order number
       is the merchantReference refunds and reports look orders up by — so a
       restart hands a real customer a number Montonio already holds (G26). */
    const report = await run(CLEAR_OK);
    expect(report.changed.sequence).toBe(true);
    expect(await count("invoice_counters")).toBe(0);
    expect(report.orderNumbers).toEqual({ highest: 100044, seqNext: 100045, next: 100045 });

    expect(await newOrderNumber()).toBe("R-100045");
    expect(formatReport(report, {})).toContain("order_number_seq      continues at R-100045 — after R-100044");
  });

  it("goes past a number the sequence never handed out — never reusing one", async () => {
    // an order that was numbered by hand, above where the sequence stands
    await query("insert into orders (number, status, items, subtotal, total) values ('R-100098', 'paid', '[]'::jsonb, 1, 1)");
    const report = await run(CLEAR_OK);
    expect(report.orderNumbers.next).toBe(100099);
    expect(await newOrderNumber()).toBe("R-100099");
  });

  it("never moves the sequence back — a number handed out for an order deleted since still counts", async () => {
    // the orders R-100045…R-100199 existed once and were deleted by hand
    await exec("alter sequence order_number_seq restart with 100200");
    const report = await run(CLEAR_OK);
    expect(report.orderNumbers).toEqual({ highest: 100044, seqNext: 100200, next: 100200 });
    expect(await newOrderNumber()).toBe("R-100200");
  });

  it("starts at R-100001 only in a shop that has never numbered an order", async () => {
    await exec("truncate orders restart identity cascade");
    await exec("alter sequence order_number_seq restart with 100001");
    const report = await run(CLEAR_OK);
    expect(report.orderNumbers).toEqual({ highest: null, seqNext: 100001, next: 100001 });
    expect(await newOrderNumber()).toBe("R-100001");
  });

  it("says in the dry run where the numbering will continue, and moves nothing", async () => {
    const report = await run({});
    expect(report.orderNumbers.next).toBe(100045);
    expect(formatReport(report, {})).toContain("order_number_seq      will continue at R-100045");
    // the dry run read the sequence without advancing it
    expect(await newOrderNumber()).toBe("R-100045");
  });

  it("reports before and after for every table", async () => {
    const report = await run(CLEAR_OK);
    expect(report.before.tables.orders.n).toBe(3);
    expect(report.after!.tables.orders.n).toBe(0);
    expect(report.after!.tables.mail_optouts.fp).toBe(report.before.tables.mail_optouts.fp);

    const text = formatReport(report, {});
    expect(text).toContain("go-live-reset — CLEARED.");
    expect(text).toContain("every KEEP table verified unchanged before the commit");
  });
});

/* ---------- stock -------------------------------------------------------- */

describe("stock", () => {
  it("is left alone without the flag", async () => {
    await run(CLEAR_OK);
    expect(await count("stock_levels")).toBe(1);
    expect(await count("stock_moves")).toBe(2);
    const lvl = await query<{ qty: number; ean: string }>("select qty::int as qty, ean from stock_levels");
    expect(lvl[0]).toEqual({ qty: 11, ean: "4601234567890" });
  });

  it("goes as a pair when the flag is given", async () => {
    await run({ ...CLEAR_OK, stock: true });
    expect(await count("stock_levels")).toBe(0);
    expect(await count("stock_moves")).toBe(0);
  });
});

/* ---------- the gift-card liability check -------------------------------- */

describe("gift cards", () => {
  it("refuses a live card bought by an order that was paid", async () => {
    const said = await refusal({ clear: true });
    expect(said).toContain("20.00 EUR");
    expect(said).toContain("paid/shipped/delivered");
    expect(said).toContain("--gift-cards-are-test-cards");
    expect(await count("orders")).toBe(3); // and nothing happened
    expect(await count("gift_cards")).toBe(1);
  });

  it("refuses a card with no order behind it", async () => {
    await query("update gift_cards set balance = 0"); // take the paid-order case out of the way
    await query("insert into gift_cards (code, amount, balance, order_id) values ('RMP-HAND-0002', 40, 40, null)");
    expect(await refusal({ clear: true })).toContain("no order behind them");
  });

  it("proceeds once the owner says they are test cards", async () => {
    const report = await run(CLEAR_OK);
    expect(report.guard.live.n).toBe(1);
    expect(report.guard.live.total).toBeCloseTo(20);
    expect(report.guard.paid.n).toBe(1);
    expect(await count("gift_cards")).toBe(0);
    expect(await count("gift_card_uses")).toBe(0);
  });

  it("does not block on a card that is spent out", async () => {
    await query("update gift_cards set balance = 0");
    const report = await run({ clear: true });
    expect(report.guard.live.n).toBe(0);
    expect(report.guard.blocked).toBe(false);
  });
});

/* ---------- --test-content (the owner's decision, 28.09.2026) ------------- */

/**
 * The staging content Dim called test data: codes, sets, posts, letters, and
 * own products (`c-…`) with their price edits and stock — next to an imported
 * product (`touchable`, in src/data/catalogue.min.json) whose edit, count,
 * barcode and history must come out byte-identical.
 */
async function seedTestContent(): Promise<void> {
  await query(
    `insert into custom_products (id, brand, name, cat, active) values
       ('c-rempire-hoodie', 'Rempire', 'Худи', 'merch', true),
       ('c-davines-cheap-price', 'Davines', 'Cheap price', 'hair', false),
       ('c-real-thing', 'Rempire', 'Настоящий товар', 'merch', true)`,
  );
  await query(
    `insert into product_overrides (product_id, price) values
       ('c-rempire-hoodie', 1), ('c-real-thing', 25), ('c-gone-long-ago', 9)`,
  );
  await query(
    `insert into stock_levels (product_id, variant, qty, ean) values
       ('c-rempire-hoodie', 'XXS', 3, '2000000000011'), ('c-real-thing', 'one', 5, null)`,
  );
  await query(
    `insert into stock_moves (product_id, variant, delta, reason, ref, actor) values
       ('c-rempire-hoodie', 'XXS', 3, 'goods_in', 'проба', 'admin'),
       ('c-real-thing', 'one', 5, 'goods_in', 'приход', 'admin')`,
  );
  await query("insert into bundles (id, cat, name_ru, items, active) values ('made-up-set', 'hair', 'Придуманный набор', '[]'::jsonb, false)");
  await query("insert into posts (slug, status, title, body, deleted_at) values ('chernovik', 'draft', $1::jsonb, '{}'::jsonb, now())", [
    JSON.stringify({ EN: "A draft in the bin" }),
  ]);
  await query("insert into newsletters (status, title, subject, body) values ('draft', 'Черновик', $1::jsonb, '{}'::jsonb)", [
    JSON.stringify({ RU: "Проба рассылки" }),
  ]);
}

/** Every row of the imported product, in all four product-keyed tables. */
async function importedRows(): Promise<unknown[]> {
  return [
    await query("select * from product_overrides where product_id = 'touchable'"),
    await query("select * from stock_levels where product_id = 'touchable'"),
    await query("select * from stock_moves where product_id = 'touchable' order by id"),
  ];
}

const WITH_CONTENT = { ...CLEAR_OK, testContent: true };

describe("--test-content", () => {
  beforeEach(seedTestContent);

  it("deletes every code, set, post, letter and own product — exactly those", async () => {
    const report = await run(WITH_CONTENT);
    for (const t of ["promo_codes", "promo_code_uses", "bundles", "posts", "newsletters", "newsletter_sends", "custom_products"]) {
      expect(await count(t), t).toBe(0);
    }
    // only the imported product's rows are left in the product-keyed tables
    const left = async (table: string) =>
      (await query<{ product_id: string }>(`select distinct product_id from ${table} order by product_id`)).map((r) => r.product_id);
    expect(await left("product_overrides")).toEqual(["touchable"]);
    expect(await left("stock_levels")).toEqual(["touchable"]);
    expect(await left("stock_moves")).toEqual(["touchable"]);
    // and the rest of the shop is what it always was
    expect(await count("settings")).toBe(7);
    expect(await count("mail_optouts")).toBe(2);
    expect(await count("admin_audit")).toBe(4);
    expect(report.content!.going).toEqual([
      "c-davines-cheap-price",
      "c-gone-long-ago",
      "c-real-thing",
      "c-rempire-hoodie",
      "salon-towel",
    ]);
  });

  it("leaves every imported product's edit, count, barcode and history byte-identical", async () => {
    const before = await importedRows();
    await run(WITH_CONTENT);
    expect(await importedRows()).toEqual(before);
    const lvl = await query<{ qty: number; ean: string }>("select qty::int as qty, ean from stock_levels");
    expect(lvl).toEqual([{ qty: 11, ean: "4601234567890" }]);
  });

  it("keeps the own product --keep-product names, with its edits and stock", async () => {
    const report = await run({ ...WITH_CONTENT, keepProducts: ["c-real-thing"] });
    expect((await query<{ id: string }>("select id from custom_products")).map((r) => r.id)).toEqual(["c-real-thing"]);
    const ov = await query<{ product_id: string; price: string }>(
      "select product_id, price::text as price from product_overrides order by product_id",
    );
    expect(ov).toEqual([
      { product_id: "c-real-thing", price: "25.00" },
      { product_id: "touchable", price: "21.50" },
    ]);
    expect(await count("stock_levels")).toBe(2);
    expect(await count("stock_moves")).toBe(3);
    expect(report.content!.kept.map((p) => p.id)).toEqual(["c-real-thing"]);
    expect(report.content!.going).not.toContain("c-real-thing");
  });

  it("refuses a --keep-product that names no own product, and changes nothing", async () => {
    const said = await refusal({ ...WITH_CONTENT, keepProducts: ["c-real-thnig"] });
    expect(said).toContain("--keep-product c-real-thnig: there is no own product with that id");
    expect(await count("custom_products")).toBe(4);
    expect(await count("orders")).toBe(3);
    // an orphan's left-over rows are not a product either
    expect(await refusal({ ...WITH_CONTENT, keepProducts: ["c-gone-long-ago"] })).toContain("no own product");
  });

  it("refuses --keep-product without --test-content, and an id a shell would read", async () => {
    expect(await refusal({ ...CLEAR_OK, keepProducts: ["c-real-thing"] })).toContain("only means something together with --test-content");
    expect(await refusal({ ...WITH_CONTENT, keepProducts: ["c-x; rm -rf"] })).toContain("is not a product id");
    expect(await count("custom_products")).toBe(4);
  });

  it("refuses to delete an own product that is also an imported one", async () => {
    // cannot happen through the app (every own id starts with c-); typed into the database, it could
    expect(catalogueIds().has("touchable")).toBe(true);
    await query("insert into custom_products (id, brand, name, cat) values ('touchable', 'Kevin.Murphy', 'Touchable', 'hair')");
    const dry = await run({ testContent: true });
    expect(formatReport(dry, {})).toContain("! touchable is an own product AND an imported one");
    expect(await refusal(WITH_CONTENT)).toContain("touchable is an own product AND an imported one");
    expect(await count("product_overrides")).toBe(4);
  });

  it("lists every one of them by name in the dry run, and changes nothing", async () => {
    const counts: Record<string, number> = {};
    for (const t of ALL_TABLES) counts[t] = await count(t);

    const report = await run({ testContent: true, keepProducts: ["c-real-thing"] });
    const text = formatReport(report, { launcher: "node --env-file=.env.railway.txt" });
    for (const t of ALL_TABLES) expect(await count(t), t).toBe(counts[t]);

    expect(text).toContain("TEST CONTENT — deleted too, because --test-content was given");
    // every promo code, every set name, every post title, every letter subject, every own product id + name
    for (const s of [
      "promo codes · 2",
      "TEST5",
      "WELCOME10",
      "sets · 2",
      "«Дуэт ухода»",
      "«Придуманный набор»  (off)",
      "blog posts · 2",
      "«Как мыть голову»  (published)",
      "«A draft in the bin»  (in the bin)",
      "newsletters · 2",
      "«Скидки осени»  (sent; in the panel: Осенняя рассылка)",
      "«Проба рассылки»  (draft",
      "own products · 3",
      "c-rempire-hoodie",
      "Rempire — Худи",
      "Davines — Cheap price  (off sale)",
      "salon-towel",
      "Rempire — Полотенце",
      "left-over rows of own products that no longer exist · 1",
      "c-gone-long-ago",
      "KEPT by --keep-product · 1",
      "c-real-thing",
    ]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("with their 2 product edit row(s), 1 stock row(s) (1 with a barcode), 1 stock move(s)");
    // the → column says what is left of each table
    expect(text).toMatch(/posts\s+2 → 0\s+all of them, --test-content/);
    expect(text).toMatch(/custom_products\s+4 → 1\s+the own products, --test-content — 1 kept by --keep-product/);
    expect(text).toMatch(/product_overrides\s+4 → 2\s+only the own products' rows/);
    expect(text).toMatch(/stock_levels\s+3 → 2\s+only the own products' rows/);
    // the pasteable line carries the flag and the keep, in that order
    expect(text).toContain(
      `  node --env-file=.env.railway.txt tools/go-live-reset.mjs --clear --confirm "${CONFIRM_PHRASE}" --test-content --keep-product c-real-thing --gift-cards-are-test-cards`,
    );
    expect(text).toContain("only after the owner has read every name under TEST CONTENT");
  });

  it("reports what it deleted after the clear, by name", async () => {
    const text = formatReport(await run(WITH_CONTENT), {});
    expect(text).toContain("TEST CONTENT — deleted, because --test-content was given");
    expect(text).toContain("«Придуманный набор»");
    expect(text).toMatch(/custom_products\s+4 → 0/);
    expect(text).toMatch(/product_overrides\s+4 → 1/);
    expect(text).toContain("promo_codes, newsletters  deleted whole by --test-content");
    expect(text).toContain("imported products' edits and stock row by row");
  });

  it("takes the own products' stock rows even when --stock takes the rest", async () => {
    /* The launch-day line (Dim, 28.09.2026): --stock --test-content together. */
    const dry = formatReport(await run({ stock: true, testContent: true }), {});
    expect(dry).toContain(`--confirm "${CONFIRM_PHRASE}" --stock --test-content --gift-cards-are-test-cards`);
    expect(dry).toMatch(/stock_levels\s+3 → 0\n/);
    expect(dry).toContain("(The whole stock goes too, but that is --stock — see STOCK above.)");
    await run({ ...WITH_CONTENT, stock: true });
    expect(await count("stock_levels")).toBe(0);
    expect(await count("stock_moves")).toBe(0);
    expect(await count("product_overrides")).toBe(1);
  });

  it("without the flag: nothing of it moves, and the dry run only counts it", async () => {
    const dry = formatReport(await run({}), {});
    expect(dry).toContain(
      "TEST CONTENT — not touched without --test-content · 2 promo code(s), 2 set(s), 2 blog post(s), 2 newsletter(s), 4 own product(s)",
    );
    expect(dry).not.toContain("«Придуманный набор»");
    expect(dry).not.toContain("--test-content --");
    expect(dry).toContain(`--confirm "${CONFIRM_PHRASE}" --gift-cards-are-test-cards`);

    await run(CLEAR_OK);
    expect(await count("custom_products")).toBe(4);
    expect(await count("product_overrides")).toBe(4);
    expect(await count("stock_levels")).toBe(3);
    expect(await count("stock_moves")).toBe(4);
    expect(await count("bundles")).toBe(2);
    expect(await count("posts")).toBe(2);
    expect(await count("promo_codes")).toBe(2);
    expect(await count("newsletters")).toBe(2);
  });

  it("puts the flags in one fixed order wherever a line is printed", () => {
    expect(flagsLine({ testContent: true, keepProducts: ["c-a", "c-b"], giftCardsAreTest: true, stock: true })).toBe(
      " --stock --test-content --keep-product c-a --keep-product c-b --gift-cards-are-test-cards",
    );
    expect(flagsLine({})).toBe("");
  });

  it("deletes its tables after their children and by row where a product owns the row", () => {
    const tc = TEST_CONTENT_TABLES as unknown as string[];
    expect([...tc].sort()).toEqual(["bundles", "newsletters", "posts", "promo_codes"]);
    // promo_code_uses and newsletter_sends are on the always-clear list, which runs first
    expect(deleteOrder).toContain("promo_code_uses");
    expect(deleteOrder).toContain("newsletter_sends");
    const keys = (OWN_PRODUCT_KEYS as unknown as Array<[string, string]>).map(([t]) => t);
    expect(keys).toEqual(["stock_moves", "stock_levels", "product_overrides", "custom_products"]);
    for (const t of [...tc, ...keys]) expect(plan.find((p) => p.table === t)?.verdict).not.toBe("clear");
  });
});

/* ---------- the proof ---------------------------------------------------- */

describe("verification", () => {
  it("refuses a schema it has not been told about", async () => {
    await exec("create table if not exists surprise_r24 (id int primary key)");
    try {
      const dry = await run({});
      expect(dry.schemaIssues.join(" ")).toContain("surprise_r24");
      expect(formatReport(dry, {})).toContain("never been told about");
      expect(await refusal({ clear: true })).toContain("surprise_r24");
      expect(await count("orders")).toBe(3);
    } finally {
      await exec("drop table if exists surprise_r24");
    }
  });

  it("refuses a database the migrations have not reached, dry run and all", async () => {
    const missing = schemaMissing(["settings", "orders"]) as unknown as string[];
    expect(missing.length).toBe(plan.length - 2);
    expect(missing.join(" ")).toContain("npm run migrate");
  });

  it("calls out the stop list by name when it moves", () => {
    const after = fixture();
    after.tables.mail_optouts = { n: 0, fp: "-" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("THE STOP LIST CHANGED (2 → 0)");
  });

  it("catches settings taken along for the ride", () => {
    const after = fixture();
    after.settingsKept = { n: 3, fp: "different" };
    after.tables.settings = { n: 3, fp: "different" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("a row other than the keys this tool removes by name");
  });

  it("catches a settings key it was told to remove and did not", () => {
    const after = fixture();
    after.tables.settings = { n: 8, fp: "fp:settings" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("still there");
  });

  it("catches a clear table that did not empty", () => {
    const after = fixture();
    after.tables.orders = { n: 1, fp: "x" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("orders: should be empty, still has 1 row(s)");
  });

  it("catches a promo definition that changed under the counter reset", () => {
    const after = fixture();
    after.promoCodesKept = { n: 2, fp: "moved" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("other than the `used` counter");
  });

  it("catches a newsletter whose text changed", () => {
    const after = fixture();
    after.newslettersKept = { n: 1, fp: "moved" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("only the send state may be reset");
  });

  it("catches a blog post that went missing", () => {
    const after = fixture();
    after.tables.posts = { n: 0, fp: "-" };
    expect(verify(fixture(), after, {}).join(" | ")).toContain("posts: 1 row(s) before, 0 after");
  });

  it("is quiet when everything went the way it should", () => {
    const after = fixture();
    for (const t of clearList) after.tables[t] = { n: 0, fp: "-" };
    after.tables.settings = { n: 7, fp: "fp:settings-after" };
    expect(verify(fixture(), after, {})).toEqual([]);
  });

  it("knows --test-content: quiet when only the named rows went", () => {
    expect(verify(contentFixture(false), contentFixture(true), { testContent: true })).toEqual([]);
    // the same after-picture without the flag is four KEEP tables that emptied
    const said = verify(contentFixture(false), contentFixture(true), {}).join(" | ");
    expect(said).toContain("posts: 1 row(s) before, 0 after");
    expect(said).toContain("custom_products: 2 row(s) before, 1 after");
  });

  it("knows --test-content: an imported product's row that moved is a rollback", () => {
    const after = contentFixture(true);
    after.own!.product_overrides.kept = { n: 1, fp: "moved" };
    expect(verify(contentFixture(false), after, { testContent: true }).join(" | ")).toContain(
      "product_overrides: a row that belongs to no deleted own product changed",
    );
  });

  it("knows --test-content: an own product's row left behind, or a content table not empty, is a rollback", () => {
    const left = contentFixture(true);
    left.own!.stock_levels.going = { n: 1, fp: "(count only)" };
    expect(verify(contentFixture(false), left, { testContent: true }).join(" | ")).toContain(
      "stock_levels: 1 row(s) of the deleted own products are still there",
    );
    const notEmpty = contentFixture(true);
    notEmpty.tables.posts = { n: 1, fp: "x" };
    expect(verify(contentFixture(false), notEmpty, { testContent: true }).join(" | ")).toContain(
      "posts: should be empty, still has 1 row(s)",
    );
  });

  it("will not call --test-content verified without the row-by-row picture", () => {
    const after = contentFixture(true);
    delete after.own;
    expect(verify(contentFixture(false), after, { testContent: true }).join(" | ")).toContain("no row-by-row picture");
  });
});

/**
 * fixture() for --test-content: before, every product-keyed table has one
 * imported row and one own row; after, the own rows and the four content
 * tables are gone and everything else is the same.
 */
function contentFixture(after: boolean): Snapshot {
  const s = fixture();
  s.own = {};
  for (const [t] of OWN_PRODUCT_KEYS as unknown as Array<[string, string]>) {
    s.tables[t] = { n: after ? 1 : 2, fp: `fp:${t}:${after ? "after" : "before"}` };
    s.own[t] = { kept: { n: 1, fp: `kept:${t}` }, going: { n: after ? 0 : 1, fp: "(count only)" } };
  }
  if (after) {
    for (const t of clearList) s.tables[t] = { n: 0, fp: "-" };
    for (const t of TEST_CONTENT_TABLES as unknown as string[]) s.tables[t] = { n: 0, fp: "-" };
    s.tables.settings = { n: 7, fp: "fp:settings-after" };
    s.promoCodesKept = { n: 0, fp: "-" };
    s.newslettersKept = { n: 0, fp: "-" };
  }
  return s;
}

/**
 * A hand-made snapshot, the shape snapshot() returns, with the clear tables
 * still full. Each test breaks exactly one thing in its copy — the only way to
 * reach the rollback path without corrupting a real database mid-transaction.
 */
function fixture(): Snapshot {
  const tables: Record<string, Stats> = {};
  for (const p of plan) tables[p.table] = { n: p.table === "mail_optouts" ? 2 : 1, fp: `fp:${p.table}` };
  tables.settings = { n: 7, fp: "fp:settings" };
  return {
    tables,
    promoCodesKept: { n: 2, fp: "fp:promo" },
    newslettersKept: { n: 1, fp: "fp:news" },
    settingsKept: { n: 7, fp: "fp:settings-kept" },
  };
}
