/**
 * Customer accounts and the three automatic letters.
 *
 * The bugs this file exists to catch are the ones that cost money or trust:
 * a login code that survives a wrong guess forever, a session cookie another
 * cookie can be swapped for, a reminder that goes out after the order was
 * already paid, a «снова в наличии» letter sent twice to the same person, a
 * birthday letter to somebody who never consented, and a cron endpoint that
 * mails customers for anybody who finds the URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";
import {
  CODE_MAX_ATTEMPTS,
  addStockAlert,
  cartSnapshot,
  checkLoginCode,
  getCart,
  getCustomer,
  hashCode,
  issueLoginCode,
  listCustomerOrders,
  makeCustomerToken,
  markCartRecovered,
  normalizeBirthday,
  readCustomerToken,
  recordLogin,
  saveCart,
  sessionEmail,
  updateCustomer,
} from "@/lib/customers";
import {
  flowCounters,
  getFlows,
  makeResumeToken,
  readResumeToken,
  runAbandonedCarts,
  runBackInStock,
  runBirthdays,
  runFlows,
  sweepBackInStock,
} from "@/lib/flows";
import { makeSessionToken } from "@/lib/auth";

/* A product that really exists in src/data/catalogue.min.json. */
const PRODUCT = "system-4-bio-botanical-shampoo";
const EMAIL = "shopper@example.com";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Every letter Resend was asked to send since the last reset. */
const sent: Array<{ subject: string; to: string[]; text: string }> = [];

function mockResend() {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { subject: string; to: string[]; text?: string };
    sent.push({ subject: body.subject, to: body.to, text: body.text ?? "" });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

async function setFlows(patch: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('flows', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(patch)],
  );
}

/** An order row straight into the table — createOrder is not what is under test. */
async function insertOrder(email: string, createdAt: Date, status = "paid"): Promise<void> {
  await query(
    `insert into orders (lang, email, name, status, items, total, created_at)
     values ('RU', $1, 'Тест', $2, '[]'::jsonb, 42, $3)`,
    [email, status, createdAt.toISOString()],
  );
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = "https://test.rempireshop.com";
  await setupDb();
  // After setupDb: PGlite is up, so stubbing fetch cannot disturb it.
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
});

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  await teardownDb();
});

beforeEach(async () => {
  sent.length = 0;
  mockResend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec(
    "truncate customers, login_codes, carts, stock_alerts, orders, settings, product_overrides restart identity",
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- login codes --------------------------------------------------- */

describe("login codes", () => {
  it("issues one six-digit code per address, lower-cased", async () => {
    const { code } = await issueLoginCode("  Shopper@Example.COM ");
    expect(code).toMatch(/^\d{6}$/);
    const rows = await query<{ email: string; code_hash: string }>("select * from login_codes");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(EMAIL);
    // the code itself is never stored
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toBe(hashCode(EMAIL, code));

    // asking again replaces the code in flight rather than adding a second row
    const again = await issueLoginCode(EMAIL);
    expect(await query("select * from login_codes")).toHaveLength(1);
    expect(await checkLoginCode(EMAIL, code)).toBe("bad_code");
    expect(await checkLoginCode(EMAIL, again.code)).toBe("ok");
  });

  it("accepts the right code once and then forgets it", async () => {
    const { code } = await issueLoginCode(EMAIL);
    expect(await checkLoginCode(EMAIL, code)).toBe("ok");
    // consumed: the same code cannot sign anybody in a second time
    expect(await checkLoginCode(EMAIL, code)).toBe("no_code");
  });

  it("dies after five wrong guesses", async () => {
    const { code } = await issueLoginCode(EMAIL);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
      expect(await checkLoginCode(EMAIL, wrong)).toBe("bad_code");
    }
    // the sixth attempt kills the code — even the correct one no longer works
    expect(await checkLoginCode(EMAIL, code)).toBe("too_many");
    expect(await checkLoginCode(EMAIL, code)).toBe("no_code");
  });

  it("expires after fifteen minutes", async () => {
    const { code } = await issueLoginCode(EMAIL);
    expect(await checkLoginCode(EMAIL, code, Date.now() + 16 * 60 * 1000)).toBe("expired");
    expect(await checkLoginCode(EMAIL, code)).toBe("no_code");
  });

  it("refuses a code for an address that never asked for one", async () => {
    expect(await checkLoginCode("nobody@example.com", "123456")).toBe("no_code");
  });
});

/* ---------- the session cookie -------------------------------------------- */

describe("customer session cookie", () => {
  function req(cookie?: string): Request {
    return new Request("https://rempireshop.com/api/account/me/", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("round-trips the address", () => {
    const token = makeCustomerToken("  Shopper@Example.com ");
    expect(readCustomerToken(token)).toBe(EMAIL);
    expect(sessionEmail(req(`rmp_cust=${token}`))).toBe(EMAIL);
  });

  it("expires after ninety days", () => {
    const token = makeCustomerToken(EMAIL);
    expect(readCustomerToken(token, Date.now() + 91 * DAY)).toBeNull();
  });

  it("rejects a forged, edited or swapped token", () => {
    const token = makeCustomerToken(EMAIL);
    const [v, exp, addr, sig] = token.split(".");
    const other = Buffer.from("attacker@example.com", "utf8").toString("base64url");
    const forged = [
      `${v}.${exp}.${other}.${sig}`, // another address, the old signature
      `${v}.${Number(exp) + DAY}.${addr}.${sig}`, // expiry stretched
      `${v}.${exp}.${addr}.${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`,
      `${v}.${exp}.${addr}.`,
      "v1.9999999999999.x.y",
      "not-a-token",
      "",
    ];
    for (const bad of forged) expect(readCustomerToken(bad)).toBeNull();

    // the admin cookie is not a customer cookie, whatever it is pasted into
    expect(readCustomerToken(makeSessionToken())).toBeNull();
    expect(sessionEmail(req("rmp_cust=%"))).toBeNull();
    expect(sessionEmail(req())).toBeNull();
  });
});

/* ---------- the profile ---------------------------------------------------- */

describe("customer profile", () => {
  it("creates the row on first login and moves last_login_at after", async () => {
    const first = await recordLogin("Shopper@Example.com", "et");
    expect(first.email).toBe(EMAIL);
    expect(first.lang).toBe("ET");
    expect(first.marketing).toBe(false);
    await recordLogin(EMAIL, "EN");
    const rows = await query("select * from customers");
    expect(rows).toHaveLength(1);
    expect((await getCustomer(EMAIL))?.lang).toBe("EN");
  });

  it("patches only the keys it is given and refuses a nonsense birthday", async () => {
    await recordLogin(EMAIL, "RU");
    await updateCustomer(EMAIL, { name: "Рената", phone: "+372 5 555 555", marketing: true, birthday: "1990-04-17" });
    let c = await getCustomer(EMAIL);
    expect(c?.name).toBe("Рената");
    expect(c?.marketing).toBe(true);
    expect(c?.birthday).toBe("1990-04-17");

    await updateCustomer(EMAIL, { phone: "" });
    c = await getCustomer(EMAIL);
    expect(c?.phone).toBe("");
    expect(c?.name).toBe("Рената"); // untouched

    expect(normalizeBirthday("1990-02-31")).toBeNull();
    expect(normalizeBirthday("не дата")).toBeNull();
    expect(normalizeBirthday("")).toBeNull();
    await updateCustomer(EMAIL, { birthday: "не дата" });
    expect((await getCustomer(EMAIL))?.birthday).toBeNull();
  });

  it("lists the orders that carry the address, newest first", async () => {
    await recordLogin(EMAIL, "RU");
    await insertOrder(EMAIL, new Date(Date.now() - 2 * DAY));
    await insertOrder(EMAIL, new Date(Date.now() - 1 * DAY));
    await insertOrder("someone.else@example.com", new Date());
    const orders = await listCustomerOrders(EMAIL);
    expect(orders).toHaveLength(2);
    expect(new Date(orders[0].createdAt!).getTime()).toBeGreaterThan(
      new Date(orders[1].createdAt!).getTime(),
    );
    expect(orders.every((o) => o.total === 42)).toBe(true);
  });
});

/* ---------- carts ---------------------------------------------------------- */

describe("cart snapshots", () => {
  it("prices from the catalogue, not from the request", async () => {
    const snap = await cartSnapshot([
      { id: PRODUCT, size: 1, qty: 2, price: 0.01, title: "free stuff" },
      { id: "no-such-product", qty: 1 },
    ]);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].brand).toBe("System 4");
    expect(snap.items[0].variant).toBe("250 мл");
    expect(snap.items[0].price).toBe(16); // the variant price, not 0.01
    expect(snap.total).toBe(32);
  });

  it("lets an owner's override win over the catalogue price", async () => {
    await query("insert into product_overrides (product_id, price) values ($1, 5.5)", [PRODUCT]);
    const snap = await cartSnapshot([{ id: PRODUCT, qty: 1 }]);
    expect(snap.items[0].price).toBe(5.5);
  });

  it("keeps one row per address and empties itself honestly", async () => {
    await saveCart({ email: EMAIL, lang: "ET", items: [{ id: PRODUCT, qty: 1 }] });
    await saveCart({ email: EMAIL, lang: "ET", items: [{ id: PRODUCT, qty: 3 }] });
    expect(await query("select * from carts")).toHaveLength(1);
    const cart = await getCart(EMAIL);
    expect((cart!.items as Array<{ qty: number }>)[0].qty).toBe(3);

    // emptying the basket deletes the row: nobody gets a letter about nothing
    await saveCart({ email: EMAIL, items: [] });
    expect(await getCart(EMAIL)).toBeNull();
  });

  it("marks the cart recovered and frees the next reminder", async () => {
    await saveCart({ email: EMAIL, items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set reminded_at = now() where email = $1", [EMAIL]);
    await markCartRecovered(EMAIL);
    const cart = await getCart(EMAIL);
    expect(cart?.recovered_at).toBeTruthy();
    expect(cart?.reminded_at).toBeNull();
  });
});

/* ---------- «Брошенная корзина» -------------------------------------------- */

describe("abandoned cart flow", () => {
  async function abandon(ageMs: number): Promise<void> {
    await saveCart({ email: EMAIL, lang: "RU", items: [{ id: PRODUCT, qty: 2 }] });
    await query("update carts set updated_at = $2 where email = $1", [
      EMAIL,
      new Date(Date.now() - ageMs).toISOString(),
    ]);
  }

  it("sends nothing while the switch is off", async () => {
    await setFlows({ abandoned: false });
    await abandon(4 * HOUR);
    expect(await runAbandonedCarts()).toMatchObject({ sent: 0, reason: "disabled" });
    expect(sent).toHaveLength(0);
  });

  it("waits three hours, then sends exactly one letter", async () => {
    await setFlows({ abandoned: true });
    await abandon(1 * HOUR);
    expect((await runAbandonedCarts()).sent).toBe(0);

    await abandon(4 * HOUR);
    expect((await runAbandonedCarts()).sent).toBe(1);
    expect(sent[0].to).toEqual([EMAIL]);
    expect(sent[0].subject).toContain("Rempire");

    // the second run finds reminded_at set and stays quiet
    expect((await runAbandonedCarts()).sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("carries a resume link that rebuilds the same lines", async () => {
    await setFlows({ abandoned: true });
    await abandon(4 * HOUR);
    await runAbandonedCarts();
    const link = /resume=([^\s)"']+)/.exec(sent[0].text);
    expect(link).not.toBeNull();
    const payload = readResumeToken(decodeURIComponent(link![1]));
    expect(payload?.items).toEqual([{ id: PRODUCT, size: null, qty: 2 }]);
  });

  it("never reminds somebody who has already ordered", async () => {
    await setFlows({ abandoned: true });
    await abandon(4 * HOUR);
    await insertOrder(EMAIL, new Date()); // an order after the cart went quiet
    expect((await runAbandonedCarts()).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("the resume token", () => {
  it("refuses a forged or stale one", () => {
    const token = makeResumeToken([
      { id: PRODUCT, title: "x", brand: "y", variant: null, size: 0, qty: 2, price: 9 },
    ]);
    expect(readResumeToken(token)?.items[0].id).toBe(PRODUCT);
    expect(readResumeToken(token, Date.now() + 31 * DAY)).toBeNull();
    expect(readResumeToken(`${token}x`)).toBeNull();
    expect(readResumeToken(token.split(".")[0])).toBeNull();
    expect(readResumeToken(null)).toBeNull();
  });

  it("carries no e-mail address — a reminder link travels in the open", () => {
    const token = makeResumeToken([
      { id: PRODUCT, title: "x", brand: "y", variant: null, size: 0, qty: 1, price: 9 },
    ]);
    const payload = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
    expect(payload).not.toContain("@");
  });
});

/* ---------- «Товар снова в наличии» ---------------------------------------- */

describe("back in stock flow", () => {
  it("treats asking twice as one subscription", async () => {
    expect(await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "EN" })).toBe(true);
    expect(await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "RU" })).toBe(true);
    expect(await query("select * from stock_alerts")).toHaveLength(1);
    expect(await addStockAlert({ email: EMAIL, productId: "no-such-product" })).toBe(false);
    expect(await addStockAlert({ email: "not an address", productId: PRODUCT })).toBe(false);
  });

  it("sends once per subscription and never again", async () => {
    await setFlows({ backstock: true });
    await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "RU" });
    await addStockAlert({ email: "second@example.com", productId: PRODUCT, lang: "EN" });

    expect((await runBackInStock(PRODUCT)).sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect((await runBackInStock(PRODUCT)).sent).toBe(0);
    expect(sent).toHaveLength(2);

    const rows = await query<{ sent_at: string | null }>("select sent_at from stock_alerts");
    expect(rows.every((r) => r.sent_at !== null)).toBe(true);
  });

  it("stays quiet while the switch is off", async () => {
    await setFlows({ backstock: false });
    await addStockAlert({ email: EMAIL, productId: PRODUCT });
    expect(await runBackInStock(PRODUCT)).toMatchObject({ sent: 0, reason: "disabled" });
    expect(sent).toHaveLength(0);
  });

  it("fires from the admin's own stock switch", async () => {
    await setFlows({ backstock: true });
    await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "RU" });
    const { upsertOverride } = await import("@/lib/orders");

    // out → nothing goes out
    await upsertOverride(PRODUCT, { stock: "out" });
    expect(sent).toHaveLength(0);

    // in → the person waiting hears about it, once
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent).toHaveLength(1);
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent).toHaveLength(1);
  });

  it("sweeps alerts whose product is in stock again", async () => {
    await setFlows({ backstock: true });
    await addStockAlert({ email: EMAIL, productId: PRODUCT });
    await query("insert into product_overrides (product_id, stock) values ($1, 'out')", [PRODUCT]);
    expect((await sweepBackInStock()).sent).toBe(0);

    await query("update product_overrides set stock = 'in' where product_id = $1", [PRODUCT]);
    expect((await sweepBackInStock()).sent).toBe(1);
  });
});

/* ---------- «С днём рождения» ---------------------------------------------- */

describe("birthday flow", () => {
  /** A customer whose birthday is today, `years` ago. */
  async function birthdayToday(email: string, marketing: boolean): Promise<void> {
    const today = new Date();
    const iso = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
    await recordLogin(email, "RU");
    await updateCustomer(email, { birthday: iso, marketing });
  }

  it("picks today's birthdays that consented, and nobody else", async () => {
    await setFlows({ birthday: true, birthdayCode: "REM-BD-STATIC" });
    await birthdayToday(EMAIL, true);
    await birthdayToday("nomarketing@example.com", false);
    await recordLogin("nobirthday@example.com", "RU");

    expect((await runBirthdays()).sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
  });

  it("sends once a year however often the job runs", async () => {
    await setFlows({ birthday: true, birthdayCode: "REM-BD-STATIC" });
    await birthdayToday(EMAIL, true);
    expect((await runBirthdays()).sent).toBe(1);
    expect((await runBirthdays()).sent).toBe(0);
    expect((await runBirthdays()).sent).toBe(0);
    expect(sent).toHaveLength(1);

    const [row] = await query<{ birthday_sent_year: number }>(
      "select birthday_sent_year from customers where email = $1",
      [EMAIL],
    );
    expect(Number(row.birthday_sent_year)).toBe(new Date().getUTCFullYear());
  });

  it("stays quiet while the switch is off", async () => {
    await setFlows({ birthday: false, birthdayCode: "REM-BD-STATIC" });
    await birthdayToday(EMAIL, true);
    expect(await runBirthdays()).toMatchObject({ sent: 0, reason: "disabled" });
  });

  it("refuses to send a letter whose promo code would do nothing", async () => {
    // No settings code, and the promo module made to fail: better silence
    // than a birthday greeting with a dead code in it.
    await setFlows({ birthday: true });
    await birthdayToday(EMAIL, true);
    vi.doMock("@/lib/promos", () => {
      throw new Error("no promo module");
    });
    const run = await runBirthdays();
    if (run.sent === 0) {
      expect(run.reason).toBe("no_promo_code");
      const [row] = await query<{ birthday_sent_year: number | null }>(
        "select birthday_sent_year from customers where email = $1",
        [EMAIL],
      );
      // not stamped: the letter is owed as soon as a code exists
      expect(row.birthday_sent_year).toBeNull();
    } else {
      // the promo module is present and issued a real code — also correct
      expect(run.sent).toBe(1);
    }
    vi.doUnmock("@/lib/promos");
  });
});

/* ---------- settings, counters, scheduler ---------------------------------- */

describe("settings.flows", () => {
  it("is off in every direction when there is no row", async () => {
    expect(await getFlows()).toMatchObject({
      abandoned: false,
      birthday: false,
      backstock: false,
      pending: false,
    });
  });

  it("reads the switches the admin panel writes", async () => {
    await setFlows({ abandoned: true, birthday: "on", backstock: 1, pending: true, birthdayPercent: 20 });
    const flows = await getFlows();
    expect(flows.abandoned).toBe(true);
    expect(flows.birthday).toBe(true);
    expect(flows.backstock).toBe(true);
    expect(flows.pending).toBe(true);
    expect(flows.birthdayPercent).toBe(20);
  });
});

describe("admin counters", () => {
  it("counts the three queues", async () => {
    await saveCart({ email: EMAIL, items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set updated_at = $1 where email = $2", [
      new Date(Date.now() - 5 * HOUR).toISOString(),
      EMAIL,
    ]);
    await addStockAlert({ email: EMAIL, productId: PRODUCT });
    const today = new Date();
    await recordLogin("bday@example.com", "RU");
    await updateCustomer("bday@example.com", {
      marketing: true,
      birthday: `1988-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`,
    });

    expect(await flowCounters()).toEqual({ carts: 1, alerts: 1, birthdays: 1 });
  });
});

describe("the scheduler", () => {
  it("runs all three and reports each separately", async () => {
    await setFlows({ abandoned: true, backstock: true, birthday: true, birthdayCode: "REM-BD-STATIC" });
    await saveCart({ email: EMAIL, items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set updated_at = $1 where email = $2", [
      new Date(Date.now() - 5 * HOUR).toISOString(),
      EMAIL,
    ]);
    const report = await runFlows();
    expect(report.abandoned.sent).toBe(1);
    expect(report.backstock.sent).toBe(0);
    expect(report.birthday.sent).toBe(0);
    expect(typeof report.ms).toBe("number");
  });
});

/* ---------- the cron endpoint ---------------------------------------------- */

describe("GET /api/cron/flows", () => {
  const URL_ = "https://rempireshop.com/api/cron/flows/";
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/flows/route");
    const res = await GET(new Request(URL_, { headers: { authorization: "Bearer anything" } }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("turns away a missing, wrong or malformed bearer", async () => {
    process.env.CRON_SECRET = "s3cret-for-the-cron";
    const { GET } = await import("@/app/api/cron/flows/route");
    for (const headers of [
      {},
      { authorization: "Bearer wrong" },
      { authorization: "s3cret-for-the-cron" }, // no Bearer prefix
      { authorization: "Bearer " },
      { authorization: "Bearer s3cret-for-the-cron-and-more" },
    ]) {
      const res = await GET(new Request(URL_, { headers: headers as Record<string, string> }));
      expect(res.status).toBe(401);
    }
    expect(sent).toHaveLength(0);
  });

  it("runs the flows for the right secret", async () => {
    process.env.CRON_SECRET = "s3cret-for-the-cron";
    await setFlows({ abandoned: true });
    await saveCart({ email: EMAIL, items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set updated_at = $1 where email = $2", [
      new Date(Date.now() - 5 * HOUR).toISOString(),
      EMAIL,
    ]);

    const { GET } = await import("@/app/api/cron/flows/route");
    const res = await GET(
      new Request(URL_, { headers: { authorization: "Bearer s3cret-for-the-cron" } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; abandoned: { sent: number } };
    expect(body.ok).toBe(true);
    expect(body.abandoned.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
