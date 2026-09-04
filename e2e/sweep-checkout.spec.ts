/**
 * Exploratory sweep, part 2 — the randomised cart and checkout.
 *
 * Part 1 (the crawl) is ./sweep-storefront.spec.ts; the shared watchdog,
 * the seeded PRNG and the money-format check live in ./sweep-shop-helpers.ts.
 *
 * What this file drives, all off one fixed seed (`SWEEP_SEED`, printed into
 * every failure message):
 *   - quantity handling at both ends of its range, and line removal;
 *   - promo codes: garbage, case/whitespace variants of a real one created
 *     through the admin API, an expired one, one below its minimum order;
 *   - gift cards: garbage, a real code bought through the shop itself, and a
 *     card worth more than the order;
 *   - ten random orders — products × sizes × quantities × country × delivery
 *     method × contact data × payment outcome — each checked against the
 *     order the *server* actually stored;
 *   - contact validation, both directions: what must be refused and what must
 *     be accepted;
 *   - the free-shipping message flipping exactly at the threshold.
 *
 * Desktop only, except the last describe: cart arithmetic, validation and
 * order totals do not change with viewport width (docs/testing.md, "Why most
 * specs run on desktop only"), and running ten paid orders three times over
 * would put the sweep well past its runtime budget for no new bugs. The one
 * mobile test walks a whole checkout at 375px for the thing that *is*
 * viewport-specific — layout.
 */
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { continueButton, freshEmail, ipHeaders, LANGS, shopUrl } from "./fixtures";
import {
  auditMoney,
  auditScreen,
  clientNav,
  coldVisit,
  type CatProduct,
  type Ctx,
  expectScreen,
  intBetween,
  label,
  makeRng,
  pickOne,
  readCatalogue,
  sample,
  SWEEP_SEED,
  warmRoutes,
  watchPage,
} from "./sweep-shop-helpers";

test.use({ extraHTTPHeaders: ipHeaders(91) });
/* The 30s default is for a test that does one thing; these walk ten paid orders.
   `test.setTimeout` in a file-level beforeEach, not
   `test.describe.configure({timeout})`, because the latter is silently
   ignored when it sits at file scope ahead of the describes. */
test.beforeEach(() => {
  test.setTimeout(180_000);
});

/* ------------------------------------------------------------------ */
/* Fixtures: three promo codes and one real gift card                   */
/* ------------------------------------------------------------------ */

/** A live 10 % code, one that has expired, and one with a 500 € floor no
 *  basket in this sweep can reach. Created through the owner's own API so the
 *  checkout is quoting a real row, not a stub. */
const PROMO_OK = "SWEEPTEN";
const PROMO_EXPIRED = "SWEEPOLD";
const PROMO_MIN = "SWEEPMIN";
const PROMO_MIN_SUBTOTAL = 500;

/** Bought through the shop, so its code and balance are the real thing. */
let giftCode = "";
const GIFT_AMOUNT = 25;

/**
 * ONE admin session for the whole file, opened on first use and reused.
 *
 * This spec needs the owner's side a dozen times (three promos, the gift-card
 * lookup, and the stored total of every one of the ten random orders) — and
 * `POST /api/admin/login/` is rate-limited to 5/min per IP (src/lib/auth.ts).
 * Logging in per call exhausted that budget partway through the file and
 * failed the rest of it on a limiter doing exactly its job.
 */
let adminCtx: BrowserContext | null = null;

async function adminRequest(browser: Browser): Promise<APIRequestContext> {
  if (!adminCtx) {
    adminCtx = await browser.newContext({ extraHTTPHeaders: ipHeaders(91) });
    const login = await adminCtx.request.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok(), "sweep-checkout: admin login").toBe(true);
  }
  return adminCtx.request;
}

test.afterAll(async () => {
  if (adminCtx) await adminCtx.close();
  adminCtx = null;
});

test.beforeAll(async ({ browser }, workerInfo) => {
  // A hook does not inherit the beforeEach timeout above — see the same note
  // in sweep-storefront.spec.ts.
  test.setTimeout(180_000);
  /* Everything below exists for the desktop tests; on `--project=mobile`
     only the phone-layout test runs and it needs neither promos nor an admin
     session. Skipping the setup there is not just faster — a fixture failure
     would otherwise be reported against the first test in the file, which is
     one that never even ran. */
  if (workerInfo.project.name !== "desktop") return;

  /* Compile every route the shop touches before anything is audited — see
     warmRoutes() in ./sweep-shop-helpers.ts. */
  const warm = await browser.newContext();
  await warmRoutes(warm.request);
  await warm.close();

  const req = await adminRequest(browser);

  for (const promo of [
    { code: PROMO_OK, kind: "percent", value: 10, minSubtotal: 0, active: true },
    // Ends in the past and never started — quotePromo() answers "expired".
    { code: PROMO_EXPIRED, kind: "percent", value: 20, minSubtotal: 0, active: true, endsAt: "2020-01-01" },
    { code: PROMO_MIN, kind: "percent", value: 15, minSubtotal: PROMO_MIN_SUBTOTAL, active: true },
  ]) {
    /* Retried: `next dev` compiles a route on its first hit, and a request
       that arrives during that compile (or during a rebuild triggered by
       someone else editing src/** — this repo has more than one agent in it)
       comes back as Next's own "reloading" HTML page rather than the route's
       JSON. Only the fixture is retried; no storefront assertion is softened. */
    let res = await req.post("/api/admin/promos/", { data: promo, timeout: 60_000 });
    for (let attempt = 0; attempt < 12 && !res.ok(); attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await req.post("/api/admin/promos/", { data: promo, timeout: 60_000 });
    }
    expect(res.ok(), `sweep-checkout: create promo ${promo.code} (${await res.text()})`).toBe(true);
  }
});

/** Buys a gift card end to end and reads the issued code back through the
 *  e2e-only admin lookup — the same route giftcard.spec.ts uses, and the only
 *  way anything can learn a real code (docs/testing.md). */
async function buyGiftCard(page: Page, browser: Browser): Promise<string> {
  await coldVisit(page, shopUrl("", "/gift/"), "gift");
  await page.locator(`[data-giftamt="${GIFT_AMOUNT}"]`).click();
  await page.locator('[data-giftf="name"]').fill("Sweep");
  await page.locator(`[data-addgift="${GIFT_AMOUNT}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();

  await clientNav(page, shopUrl("", "/checkout/"));
  await expectScreen(page, "checkout", { screen: "gift-card purchase", lang: "RU" });
  await page.locator("[data-email]").fill(freshEmail("sweep-gift"));
  await continueButton(page, 2).click();
  await page.locator('input[data-dm="pickup"]').check();
  await page.locator('[data-shipf="name"]').fill("Sweep Buyer");
  await page.locator('[data-shipf="phone"]').fill("+372 5550002");
  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await page.locator(".co__pay[data-pay]").click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
  const orderNumber = new URL(page.url()).searchParams.get("n");
  expect(orderNumber, "sweep-checkout: gift-card order number").toBeTruthy();

  const req = await adminRequest(browser);
  const lookup = await req.get(`/api/e2e/gift-card/?order=${orderNumber}`);
  expect(lookup.ok(), "sweep-checkout: gift-card lookup").toBe(true);
  const body = (await lookup.json()) as { ok: boolean; cards: Array<{ code: string; balance: number }> };
  expect(body.cards.length, "sweep-checkout: one card per gift line").toBe(1);
  return body.cards[0].code;
}

/* ------------------------------------------------------------------ */
/* Small helpers shared by the tests below                              */
/* ------------------------------------------------------------------ */

/** The total the *server* stored for an order, via the owner's own list. */
async function serverTotal(browser: Browser, orderNumber: string): Promise<number> {
  const req = await adminRequest(browser);
  const res = await req.get(`/api/admin/orders/?q=${encodeURIComponent(orderNumber)}`);
  expect(res.ok(), "sweep-checkout: admin order lookup").toBe(true);
  const body = (await res.json()) as { ok: boolean; orders: Array<{ number: string; total: number }> };
  const order = body.orders.find((o) => o.number === orderNumber);
  expect(order, `sweep-checkout: order ${orderNumber} not found server-side`).toBeTruthy();
  return order!.total;
}

/** "12,50 €" / "€12.50" → 12.5. The inverse of `eur()` in app.js. */
function parseEur(text: string, lang: string): number {
  const t = text.replace(/[  ]/g, "").replace("€", "").replace("−", "-").trim();
  return Number(lang === "EN" ? t.replace(/,/g, "") : t.replace(",", "."));
}

async function addProduct(page: Page, seg: string, id: string, sizeIdx = 0, qty = 1): Promise<void> {
  await clientNav(page, shopUrl(seg, `/p/${id}/`));
  await expectScreen(page, "product", { screen: `product:${id}`, lang: "RU" });
  const sizes = page.locator(".sizes [data-size]");
  const nSizes = await sizes.count();
  if (nSizes > 1) await sizes.nth(Math.min(sizeIdx, nSizes - 1)).click();
  for (let i = 1; i < qty; i++) await page.locator('.pdp__buy [data-qty="1"]').click();
  await page.locator(`.pdp__add[data-add="${id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
}

/** The point picker's "still fetching" sub-label, in all three languages. */
const POINTS_LOADING = /Загружаем список|Laadime nimekirja|Loading the list/;

/**
 * The delivery list for the country now selected, once the shop has made up
 * its mind about it.
 *
 * app.js offers a country's «Пакомат» optimistically — the moment that country
 * *might* have machines — and strikes off each carrier whose feed comes back
 * empty (`CARRIERS_BY_COUNTRY`'s own comment: "deliberately optimistic").
 * With no Montonio keys that is exactly what happens to Finland: the option
 * appears, then vanishes a second later when both of its carriers answer
 * empty. Selecting parcel here is what *makes* those feeds run, so this asks
 * for it deliberately and then waits for the question to be answered — either
 * the picker has a list, or the option is gone — before anything is chosen
 * from the menu for real.
 */
/**
 * app.js stamps the number of carrier feeds still in flight for the selected
 * country on the delivery block (`data-points-loading`, see patchDelivery());
 * "0" means the markup will not be rewritten from under the next click.
 */
async function waitForPointFeeds(page: Page): Promise<void> {
  await expect
    .poll(
      async () => page.locator("[data-co-delivery]").getAttribute("data-points-loading").catch(() => null),
      { timeout: 25_000, message: "parcel-point feeds never settled" },
    )
    .not.toMatch(/^[1-9]/);
}

async function settleDelivery(page: Page): Promise<string[]> {
  const parcel = page.locator('input[data-dm="parcel"]');
  if (await parcel.count()) {
    /* The block is re-patched every time a carrier feed lands, and on a slow
       runner that can go on for longer than an actionability wait — so the
       already-checked default (EE opens on «Пакомат») is left alone rather
       than re-checked, and a real switch waits for the feeds first. */
    if (!(await parcel.isChecked().catch(() => true))) await parcel.check();
    await waitForPointFeeds(page);
    await expect
      .poll(
        async () => {
          if (!(await page.locator('input[data-dm="parcel"]').count())) return "withdrawn";
          const text = (await page.locator("[data-pointopen]").textContent().catch(() => "")) || "";
          return POINTS_LOADING.test(text) ? "loading" : "ready";
        },
        { timeout: 25_000, message: "the parcel option never settled (still loading its point list)" },
      )
      .not.toBe("loading");
  }
  return page
    .locator("input[data-dm]")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).dataset.dm as string));
}

async function inStock(page: Page): Promise<CatProduct[]> {
  const { products } = await readCatalogue(page);
  return products.filter((p) => p.stock !== "out");
}

/* ------------------------------------------------------------------ */
/* 1. Quantities                                                        */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — quantities", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "cart arithmetic is viewport-independent — see the file comment");
  });

  test("the stepper clamps at both ends and never removes a line", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");
    const products = await inStock(page);
    const p = sample(makeRng(SWEEP_SEED), products, 1)[0];
    const ctx: Ctx = { screen: `cart qty:${p.id}`, lang: "RU" };

    await addProduct(page, "", p.id);
    await page.locator("[data-cart]").first().click();
    const line = page.locator(".cline").first();
    const plus = line.locator('[data-d="1"]');
    const minus = line.locator('[data-d="-1"]');
    const qty = line.locator("[data-qtyval]");

    // Up: the app's own ceiling, whatever a shopper does with the button.
    // There is no free-text quantity field anywhere in this storefront — the
    // stepper is the only way in, so "0 / -1 / 1000 / abc" cannot be typed;
    // what has to hold is that the stepper itself cannot leave the range.
    for (let i = 0; i < 20; i++) await plus.click();
    await expect(qty, `${label(ctx)} quantity ran past the app's ceiling`).toHaveText("9");

    // Down: floors at 1, and «−» is aria-disabled there. force: true because
    // CSS (pointer-events) is what blocks the pointer — this proves the
    // app.js guard, the way a keyboard Enter on the focused button would.
    for (let i = 0; i < 20; i++) await minus.click({ force: true });
    await expect(qty, `${label(ctx)} quantity fell below 1`).toHaveText("1");
    await expect(minus, `${label(ctx)} «−» is not disabled at qty 1`).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".cline"), `${label(ctx)} the stepper removed the line`).toHaveCount(1);

    await auditMoney(page, ctx);
    await auditScreen(page, w, ctx);

    // Only the explicit control removes it.
    await line.locator("[data-remove]").click();
    await expect(page.locator(".cline")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Promo codes                                                       */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — promo codes", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "code handling is viewport-independent");
  });

  test("garbage, case and whitespace variants, expired, below minimum", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");
    const products = await inStock(page);
    const p = sample(makeRng(SWEEP_SEED + 7), products, 1)[0];
    await addProduct(page, "", p.id);
    await clientNav(page, shopUrl("", "/checkout/"));
    await expectScreen(page, "checkout", { screen: "promo", lang: "RU" });
    await page.locator("[data-email]").fill(freshEmail("sweep-promo"));
    await continueButton(page, 2).click();

    const field = page.locator("[data-promo]");
    const apply = page.locator("[data-applypromo]");
    const err = page.locator('.cosum div.err[role="alert"]');
    const totalRow = page.locator(".cosum__row--tot .num");

    const applyCode = async (code: string) => {
      await field.fill(code);
      await apply.click();
    };

    const beforeText = ((await totalRow.textContent()) || "").trim();
    const before = parseEur(beforeText, "RU");

    for (const junk of ["NOSUCHCODE", "!!!", "   ", "'; drop table promo_codes; --"]) {
      const ctx: Ctx = { screen: "checkout:promo", lang: "RU", note: `garbage ${JSON.stringify(junk)}` };
      await applyCode(junk);
      if (junk.trim()) {
        await expect(err, `${label(ctx)} a bad code showed no error`).toBeVisible();
      }
      await expect(totalRow, `${label(ctx)} a bad code changed the total`).toHaveText(beforeText);
      await auditScreen(page, w, ctx);
    }

    // The same live code, written four ways a shopper plausibly writes it.
    for (const variant of [PROMO_OK, PROMO_OK.toLowerCase(), `  ${PROMO_OK}  `, `${PROMO_OK.toLowerCase()} `]) {
      const ctx: Ctx = { screen: "checkout:promo", lang: "RU", note: `variant ${JSON.stringify(variant)}` };
      await applyCode(variant);
      await expect(page.locator("[data-promooff]"), `${label(ctx)} the live code was not accepted`).toBeVisible();
      const after = parseEur((await totalRow.textContent()) || "", "RU");
      expect(after, `${label(ctx)} 10 % off did not reach the total`).toBeLessThan(before);
      await auditMoney(page, ctx);
      await auditScreen(page, w, ctx);
      await page.locator("[data-promooff]").click();
    }

    const expiredCtx: Ctx = { screen: "checkout:promo", lang: "RU", note: PROMO_EXPIRED };
    await applyCode(PROMO_EXPIRED);
    await expect(err, `${label(expiredCtx)} an expired code was not refused`).toBeVisible();
    await expect(page.locator("[data-promooff]")).toHaveCount(0);
    await auditScreen(page, w, expiredCtx);

    const minCtx: Ctx = { screen: "checkout:promo", lang: "RU", note: `${PROMO_MIN} (min ${PROMO_MIN_SUBTOTAL} €)` };
    await applyCode(PROMO_MIN);
    await expect(err, `${label(minCtx)} a below-minimum code was not refused`).toBeVisible();
    // The message has to name the floor, not just say "no" — that is the
    // whole reason /api/promos/check returns minSubtotal.
    await expect(err, `${label(minCtx)} the error does not say what the minimum is`)
      .toContainText(String(PROMO_MIN_SUBTOTAL));
    await expect(page.locator("[data-promooff]")).toHaveCount(0);
    await auditScreen(page, w, minCtx);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Gift cards                                                        */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — gift cards", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "code handling is viewport-independent");
  });

  test("garbage, a real card, and a card worth more than the order", async ({ page, browser }) => {
    const w = watchPage(page);
    if (!giftCode) giftCode = await buyGiftCard(page, browser);

    await coldVisit(page, shopUrl("", "/"), "home");
    const products = await inStock(page);
    // Deliberately one cheap line, so a 25 € card is worth more than the order.
    const cheap = products.filter((p) => p.sizes <= 1)[0] || products[0];
    await addProduct(page, "", cheap.id);
    await clientNav(page, shopUrl("", "/checkout/"));
    await expectScreen(page, "checkout", { screen: "gift", lang: "RU" });
    await page.locator("[data-email]").fill(freshEmail("sweep-giftuse"));
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="pickup"]').check();

    const field = page.locator("[data-promo]");
    const apply = page.locator("[data-applypromo]");

    // Garbage in the card's own shape (RMP- + 8 chars) takes the card branch.
    const junkCtx: Ctx = { screen: "checkout:gift", lang: "RU", note: "RMP-ZZZZ-ZZZZ" };
    await field.fill("RMP-ZZZZ-ZZZZ");
    await apply.click();
    await expect(page.locator('.cosum div.err[role="alert"]'), `${label(junkCtx)} an unknown card was accepted`)
      .toBeVisible();
    await expect(page.locator("[data-giftoff]")).toHaveCount(0);
    await auditScreen(page, w, junkCtx);

    // The real one.
    const ctx: Ctx = { screen: "checkout:gift", lang: "RU", note: `real card ${GIFT_AMOUNT} €` };
    await field.fill(giftCode);
    await apply.click();
    await expect(page.locator("[data-giftoff]"), `${label(ctx)} the real card was refused`).toBeVisible();

    // Over-spend: the discount is capped at what the order costs, never more,
    // and the leftover balance is shown rather than silently swallowed.
    const total = parseEur((await page.locator(".cosum__row--tot .num").textContent()) || "", "RU");
    expect(total, `${label(ctx)} a card bigger than the order drove the total negative`).toBeGreaterThanOrEqual(0);
    const discountRow = page.locator(".cosum__row", { hasText: /Подарочная карта/ }).locator(".num");
    const discount = Math.abs(parseEur((await discountRow.textContent()) || "", "RU"));
    expect(discount, `${label(ctx)} the card discounted more than the order is worth`).toBeLessThanOrEqual(
      GIFT_AMOUNT,
    );
    await auditMoney(page, ctx);
    await auditScreen(page, w, ctx);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Ten randomised orders                                             */
/* ------------------------------------------------------------------ */

/** Odd-but-legal contact data. Every one of these has to be accepted — the
 *  shop is not entitled to an opinion about apostrophes in surnames, plus
 *  addressing, spaces in phone numbers or a name that happens to be emoji. */
const ODD_CONTACTS: Array<{ name: string; email: string; phone: string; note: string }> = [
  { name: "O'Neil", email: "o'neil+tag@example.com", phone: "+372 5555 5555", note: "apostrophe + plus-tag" },
  { name: "  Padded Name  ", email: "  padded@example.com  ", phone: "  +372 5550003  ", note: "leading/trailing space" },
  { name: "Ω Ærik Ǽ", email: "unicode@example.com", phone: "+37255500044", note: "non-ASCII name" },
  { name: "A".repeat(300), email: "long@example.com", phone: "+372 5550005", note: "300-char name" },
  { name: "Mari-Liis Kask", email: "mari.liis+shop@example.co.uk", phone: "372 5550006", note: "hyphen + long TLD" },
];

const COUNTRIES = ["EE", "LV", "LT", "FI", "EU"] as const;

for (let scenario = 0; scenario < 10; scenario++) {
  test.describe(`sweep checkout — randomised order ${scenario + 1}`, () => {
    /* An address of its own per scenario. Choosing a country makes the shop
       ask every carrier it has for that country (five for Estonia), and
       `GET /api/shipping/points/` allows 60/min per IP — a budget ten orders
       back to back share out in about four scenarios. Ten shoppers is what
       this actually is, so ten addresses is the honest shape; the limiter
       stays fully in force for each of them (docs/testing.md, "Rate limits
       and test isolation"). 100–109 is free: no other spec uses that range. */
    test.use({ extraHTTPHeaders: ipHeaders(100 + scenario) });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "order arithmetic is viewport-independent");
    });

    test(`products × delivery × contact × outcome (seed ${SWEEP_SEED}+${scenario})`, async ({ page, browser }) => {
      const rng = makeRng(SWEEP_SEED + scenario * 101);
      const lang = LANGS[scenario % LANGS.length];
      const country = COUNTRIES[scenario % COUNTRIES.length];
      const outcome: "paid" | "failed" = scenario % 3 === 2 ? "failed" : "paid";
      const contact = ODD_CONTACTS[scenario % ODD_CONTACTS.length];
      const ctx: Ctx = {
        screen: `order ${scenario + 1}`,
        lang: lang.code,
        note: `${country} · ${contact.note} · ${outcome}`,
      };

      const w = watchPage(page);
      await coldVisit(page, shopUrl(lang.seg, "/"), "home");
      const products = await inStock(page);

      for (const p of sample(rng, products, intBetween(rng, 1, 3))) {
        await addProduct(page, lang.seg, p.id, intBetween(rng, 0, 2), intBetween(rng, 1, 4));
      }

      await clientNav(page, shopUrl(lang.seg, "/checkout/"));
      await expectScreen(page, "checkout", ctx);
      await auditScreen(page, w, ctx);
      w.reset();

      // Step 1 — contact.
      await page.locator("[data-email]").fill(contact.email);
      await continueButton(page, 2).click();

      // Step 2 — country, then whichever methods that country offers.
      await page.locator("[data-country]").selectOption(country);
      await expect(page.locator("input[data-dm]").first(), `${label(ctx)} no delivery method offered for ${country}`)
        .toBeAttached();
      const available = await settleDelivery(page);
      expect(available.length, `${label(ctx)} the delivery list for ${country} settled empty`).toBeGreaterThan(0);
      const method = pickOne(rng, available);
      await page.locator(`input[data-dm="${method}"]`).check();

      if (method === "parcel") {
        // settleDelivery() already waited for this country's point lists;
        // switching carrier starts another one, so wait again after it.
        const carriers = page.locator("[data-carrier]");
        const nCarriers = await carriers.count();
        if (nCarriers) {
          await carriers.nth(intBetween(rng, 0, nCarriers - 1)).click();
          await expect(page.locator("[data-pointopen]"), `${label(ctx)} the picker never loaded for that carrier`)
            .not.toHaveText(POINTS_LOADING, { timeout: 20_000 });
        }
        await page.locator("[data-pointopen]").click();
        const sheet = page.getByRole("dialog");
        // Live carrier feed with a committed seed behind it (docs/testing.md)
        // — always resolves to something, but not instantly.
        await expect(sheet.locator("[data-pointpick]").first(), `${label(ctx)} no parcel points offered`)
          .toBeVisible({ timeout: 20_000 });
        await sheet.locator("[data-pointpick]").first().click();
      }

      await page.locator('[data-shipf="name"]').fill(contact.name);
      await page.locator('[data-shipf="phone"]').fill(contact.phone);
      if (method === "courier") {
        await page.locator('[data-shipf="addr"]').fill("Testitänav 1-2");
        await page.locator('[data-shipf="zip"]').fill("10111");
        await page.locator('[data-shipf="city"]').fill("Tallinn");
      }
      await auditScreen(page, w, { ...ctx, screen: `${ctx.screen}:delivery` });
      w.reset();
      await continueButton(page, 3).click();

      // Step 3 — card (the one method with no further sub-choice).
      await page.locator('input[data-paym="1"]').check();
      await auditMoney(page, { ...ctx, screen: `${ctx.screen}:payment` });
      await auditScreen(page, w, { ...ctx, screen: `${ctx.screen}:payment` });
      w.reset();

      // The number on screen, read before paying — payNow() clears the basket
      // on its way to the bank, so the summary is gone afterwards.
      const shown = parseEur((await page.locator(".cosum__row--tot .num").textContent()) || "", lang.code);
      expect(Number.isFinite(shown), `${label(ctx)} the displayed total is not a number`).toBe(true);

      await page.locator(".co__pay[data-pay]").click();
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: outcome === "paid" ? "Оплатить" : "Отменить" }).click();
      await page.waitForURL(new RegExp(`/shop2.*/done/\\?.*s=${outcome}`));

      const doneCtx: Ctx = { ...ctx, screen: `${ctx.screen}:receipt` };
      await expectScreen(page, "done", doneCtx);
      const orderNumber = new URL(page.url()).searchParams.get("n") || "";
      expect(orderNumber, `${label(doneCtx)} the receipt URL carries no order number`).toMatch(/^R-\d+$/);
      await expect(page.locator(".done__num"), `${label(doneCtx)} the receipt does not show the order number`)
        .toContainText(orderNumber);
      await auditScreen(page, w, doneCtx);

      // The number the shopper agreed to is the number the server stored.
      const stored = await serverTotal(browser, orderNumber);
      expect(
        Math.round(stored * 100),
        `${label(doneCtx)} the shop showed ${shown} € but the server stored ${stored} €`,
      ).toBe(Math.round(shown * 100));
    });
  });
}

/* ------------------------------------------------------------------ */
/* 5. Contact validation, both directions                               */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — contact validation", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "validation is viewport-independent");
  });

  test("bad addresses and phones are refused with a field error; odd-but-legal ones pass", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");
    const products = await inStock(page);
    await addProduct(page, "", sample(makeRng(SWEEP_SEED + 3), products, 1)[0].id);
    await clientNav(page, shopUrl("", "/checkout/"));
    await expectScreen(page, "checkout", { screen: "validation", lang: "RU" });

    const email = page.locator("[data-email]");
    for (const bad of ["", "nope", "a@b", "a b@c.com", "two@@example.com", "trailing@example."]) {
      const ctx: Ctx = { screen: "checkout:email", lang: "RU", note: JSON.stringify(bad) };
      await email.fill(bad);
      await continueButton(page, 2).click();
      // Still on step 1, with the field marked and a message beside it.
      await expect(email, `${label(ctx)} a bad e-mail was accepted`).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator('.costep__body div.err[role="alert"]'), `${label(ctx)} no error message`)
        .toBeVisible();
      await expect(page.locator('input[data-dm="courier"]'), `${label(ctx)} the checkout advanced anyway`)
        .toHaveCount(0);
      await auditScreen(page, w, ctx);
    }

    // …and the awkward-but-real one goes through.
    const okCtx: Ctx = { screen: "checkout:email", lang: "RU", note: "o'neil+tag@example.com" };
    await email.fill("o'neil+tag@example.com");
    await continueButton(page, 2).click();
    await expect(page.locator('input[data-dm="courier"]'), `${label(okCtx)} a legal address was refused`)
      .toBeVisible();
    await auditScreen(page, w, okCtx);

    // Phone: fewer than 7 digits is not a number anyone can be reached on.
    await page.locator('input[data-dm="courier"]').check();
    await page.locator('[data-shipf="name"]').fill("Sweep Buyer");
    await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");

    for (const bad of ["", "12345", "abc", "+372"]) {
      const ctx: Ctx = { screen: "checkout:phone", lang: "RU", note: JSON.stringify(bad) };
      await page.locator('[data-shipf="phone"]').fill(bad);
      await continueButton(page, 3).click();
      await expect(page.locator('[data-shipf="phone"]'), `${label(ctx)} a bad phone was accepted`)
        .toHaveAttribute("aria-invalid", "true");
      await expect(page.locator('input[data-paym="1"]'), `${label(ctx)} the checkout advanced anyway`)
        .toHaveCount(0);
      await auditScreen(page, w, ctx);
    }

    const phoneOk: Ctx = { screen: "checkout:phone", lang: "RU", note: "+372 5555 5555" };
    await page.locator('[data-shipf="phone"]').fill("+372 5555 5555");
    await continueButton(page, 3).click();
    await expect(page.locator('input[data-paym="1"]'), `${label(phoneOk)} a legal phone was refused`).toBeVisible();
    await auditScreen(page, w, phoneOk);
  });
});

/* ------------------------------------------------------------------ */
/* 6. The free-shipping threshold                                       */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — free shipping", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "threshold arithmetic is viewport-independent");
  });

  test("the message and the price flip at exactly the threshold, not one euro past it", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");

    /* The threshold is the server's, mirrored through /api/overrides into
       SHIP_RULES — which lives inside app.js's IIFE and is not reachable from
       here. Read the number the shop itself quotes on the product page
       («…по Эстонии бесплатно от 59 €») instead of hard-coding one, so this
       test still means something the day the owner changes it. */
    const products0 = await inStock(page);
    await addProduct(page, "", products0[0].id);
    const shipLine = ((await page.locator(".pdp__ship").textContent()) || "").replace(/[  ]/g, " ");
    const quoted = shipLine.match(/от\s([\d,.]+)\s?€/);
    expect(quoted, `sweep-checkout: the product page does not quote a free-shipping floor (${shipLine})`).toBeTruthy();
    const threshold = Number(quoted![1].replace(",", "."));

    /* Build a basket that lands on that number to the cent — the catalogue
       has enough whole-euro prices for a two- or three-line subset sum to hit
       it exactly. Searched in the page, so it reads the same prices the cart
       will charge. */
    const plan = await page.evaluate((target100: number) => {
      const cat = (CATALOGUE as Array<Record<string, unknown>>).filter((p) => (p.stock as string) !== "out");
      const cents = cat.map((p) => ({ id: p.id as string, c: Math.round((p.price as number) * 100) }));
      for (let a = 0; a < cents.length; a++) {
        for (let b = a; b < cents.length; b++) {
          const two = cents[a].c + cents[b].c;
          if (two === target100) return [cents[a].id, cents[b].id];
          if (two > target100) continue;
          for (let c = b; c < cents.length; c++) {
            if (two + cents[c].c === target100) return [cents[a].id, cents[b].id, cents[c].id];
          }
        }
      }
      return null;
    }, Math.round(threshold * 100));
    expect(plan, "sweep-checkout: no basket in the catalogue sums to the threshold exactly").toBeTruthy();

    const ctx: Ctx = { screen: "free-shipping", lang: "RU", note: `threshold ${threshold} €` };
    // Start from an empty basket: products0[0] above was only there to read
    // the quoted floor off the product page.
    await page.evaluate(() => {
      // `LS` in app.js — the one key the cart and the language live under.
      try { localStorage.removeItem("rempire-shop-proto"); } catch { /* private mode */ }
    });
    await page.reload();
    for (const id of plan!) await addProduct(page, "", id);

    await page.locator("[data-cart]").first().click();
    const bar = page.locator(".freebar p");
    await expect(bar, `${label(ctx)} at exactly the threshold the bar still asks for more`)
      .toContainText("достигнут");
    await auditMoney(page, ctx);
    await auditScreen(page, w, ctx);

    // One line short of it, delivery costs money again.
    await page.locator(".cline").last().locator("[data-remove]").click();
    await expect(page.locator(".freebar p"), `${label(ctx)} below the threshold the bar still says "reached"`)
      .toContainText("До бесплатной доставки");

    // And the checkout agrees with the bar, back at the threshold.
    await page.locator("[data-closecart]").first().click();
    await addProduct(page, "", plan![plan!.length - 1]);
    await clientNav(page, shopUrl("", "/checkout/"));
    await expectScreen(page, "checkout", ctx);
    await page.locator("[data-email]").fill(freshEmail("sweep-free"));
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="courier"]').check();
    await expect(
      page.locator(".cosum__row--rule .num"),
      `${label(ctx)} the summary still charges for delivery at the threshold`,
    ).toHaveText(/Бесплатно/);
    await auditMoney(page, { ...ctx, screen: "free-shipping:checkout" });
    await auditScreen(page, w, { ...ctx, screen: "free-shipping:checkout" });
  });
});

/* ------------------------------------------------------------------ */
/* 7. The one thing that IS viewport-specific                           */
/* ------------------------------------------------------------------ */

test.describe("sweep checkout — phone layout", () => {
  test("a whole checkout at phone width never scrolls sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "this one is about the 375px layout");

    const w = watchPage(page);
    await coldVisit(page, shopUrl("/et", "/"), "home");
    const products = await inStock(page);
    const p = sample(makeRng(SWEEP_SEED + 11), products, 1)[0];
    await addProduct(page, "/et", p.id, 0, 3);

    await page.locator("[data-cart]").first().click();
    await auditScreen(page, w, { screen: "phone:cart", lang: "ET" });
    w.reset();
    await page.locator("[data-checkout]").click();

    await expectScreen(page, "checkout", { screen: "phone:checkout", lang: "ET" });
    await auditScreen(page, w, { screen: "phone:checkout step1", lang: "ET" });
    w.reset();

    await page.locator("[data-email]").fill("phone@example.com");
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="courier"]').check();
    await page.locator('[data-shipf="name"]').fill("Väga Pikk Perekonnanimi Testimiseks");
    await page.locator('[data-shipf="addr"]').fill("Väga-pika-nimega tänav 128b-14");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");
    await page.locator('[data-shipf="phone"]').fill("+372 5550007");
    await auditScreen(page, w, { screen: "phone:checkout step2", lang: "ET" });
    w.reset();

    await continueButton(page, 3).click();
    await page.locator('input[data-paym="0"]').check(); // bank links — the widest row
    await auditMoney(page, { screen: "phone:checkout step3", lang: "ET" });
    await auditScreen(page, w, { screen: "phone:checkout step3", lang: "ET" });
  });
});

declare const CATALOGUE: unknown;


