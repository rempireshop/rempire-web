import { expect, type Browser, type Page, test } from "@playwright/test";
import { continueButton, eur, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

/**
 * Admin panel. Desktop only, single run (RU) — see docs/testing.md "Why most
 * specs run on desktop only"; the admin screen is Renat's own tool, not
 * something the task asks to exercise trilingually.
 *
 * Several of these tests flip shop-wide switches that OTHER spec files
 * depend on being in their default state (sets rail, chatbot FAB, hero,
 * PRODUCT_2's price). Every such test reverts what it changed in a
 * `finally`, so a failed assertion still leaves the switch back where it
 * started — see docs/testing.md "Rate limits and test isolation" for the
 * wider reasoning about why this suite runs serially (workers: 1) in the
 * first place, which is what makes "revert before the next file starts"
 * enough on its own, no cross-file locking needed.
 *
 * Every test below gets its own fake IP (a nested describe per test, each
 * with its own `test.use`): admin login is rate-limited at 5/min
 * (src/lib/auth.ts), and this file alone logs in 8 times.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin spec — desktop project only, see docs/testing.md");
});

/** A quick, throwaway paid order. */
async function placeOrder(page: Page, email: string): Promise<string> {
  await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  return payOrder(page, email, "paid");
}

/** «Применить» writes through to PUT /api/admin/settings only after the
 *  optimistic toast — the storefront visit below must not race that write. */
async function applyAndWaitForSettingsWrite(page: Page): Promise<void> {
  const put = page.waitForResponse((r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
  await page.locator("[data-admapply]").click();
  expect((await put).ok()).toBe(true);
}

/** A switch in Настройки applies locally and PUTs in the background. A test
 *  that only waits for the toast then opens the storefront can read
 *  `/api/overrides/` *before* that write lands and see the old value — and a
 *  test that ends on the click has its context torn down with the request
 *  still in flight, leaving the switch flipped for the next spec file. Both
 *  were real: the sets toggle failed on the first and poisoned itself on the
 *  second. Always wait for the write. */
async function toggleAndWait(page: Page, selector: string): Promise<void> {
  const put = page.waitForResponse(
    (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT",
  );
  await page.locator(selector).click();
  expect((await put).ok()).toBe(true);
}

/**
 * Opens one page of Настройки. Since the phase-3 redesign the section is an
 * index of six named sub-pages rather than one long scroll (README fix #6):
 * «Главная страница» carries the banner and the two shop-wide switches,
 * «О компании» the shop's own details.
 */
async function openSettings(page: Page, sub: "home" | "company" = "home"): Promise<void> {
  await page.locator('[data-admtab="setup"][aria-current]:visible').first().click();
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(page.locator("[data-admsetback]")).toBeVisible();
}

/** A phase-3 switch is a <button aria-pressed>, not a link whose label flips. */
async function isOn(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).getAttribute("aria-pressed")) === "true";
}

/** [data-admtab="orders"] alone is ambiguous — see fixtures.ts loginAsAdmin's
 *  own comment: the "Все заказы" shortcut on «Обзор» carries the same
 *  attribute, and since the redesign both navs (the desktop sidebar and the
 *  phone bottom bar) are in the DOM with one hidden in CSS. [aria-current]
 *  narrows it to a nav item, `:visible` to this viewport's nav. */
function ordersTab(page: Page) {
  return page.locator('[data-admtab="orders"][aria-current]:visible').first();
}
/** Same for «Товары» — the section nav item, not its «Каталог» tab. */
function goodsTab(page: Page) {
  return page.locator('[data-admtab="goods"][aria-current]:visible').first();
}

/**
 * A storefront page in its own fresh browser context, not `page.context()
 * .newPage()` — a plain new page shares the admin page's HTTP cache, and
 * `GET /api/overrides/` (which app.js reads settings/prices from on boot)
 * answers `Cache-Control: public, s-maxage=30, stale-while-revalidate=120`
 * (src/app/api/overrides/route.ts). Confirmed by reproduction: a same-context
 * new page kept showing the pre-change price/setting for the full 8s a test
 * waited, where a fresh context saw the update immediately. A real shopper in
 * a different tab or a later visit is unaffected — this is purely about two
 * Playwright pages sharing one cache within a single test.
 */
async function freshStorefrontPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

test.describe("admin", () => {
  test.describe("login", () => {
    test.use({ extraHTTPHeaders: ipHeaders(90) });
    test("logs in with the test password", async ({ page }) => {
      await loginAsAdmin(page);
    });
  });

  test.describe("orders", () => {
    test.use({ extraHTTPHeaders: ipHeaders(91) });
    test("orders tab lists a real order, and «Отправлен» ships it through the confirm card", async ({ page }) => {
      const email = freshEmail("admin-orders");
      const number = await placeOrder(page, email);

      await loginAsAdmin(page);
      await ordersTab(page).click();
      // the row card: the customer's name, the mono order number, the amount
      const row = page.locator(`[data-admorder]:has-text("${number}")`).first();
      await expect(row).toBeVisible();
      await row.click();

      // the redesigned card: mono `id · time` kicker, the customer as the title
      await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
      await expect(page.locator("h1.adm-h1")).toContainText("E2E Buyer");
      // the 4-step fulfilment strip, on step 1 («Оплачен» done)
      await expect(page.locator(".adm-step--done")).toHaveCount(1);

      /* Shipping moves money's status and sends the customer a letter, so it
         goes through the confirm card — and lands in the journal with an undo
         on the toast (see README § State). */
      await page.locator("[data-admshipnow]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Отметить отправленным?");
      await page.locator("[data-admapply]").click();
      await expect(page.getByRole("status")).toContainText("отправлен");
      await expect(page.locator(".adm-toast__undo")).toBeVisible();

      // and the order really moved: the badge on the card says so
      await expect(page.locator(".adm-badge--ok").first()).toHaveText("Отправлен");
    });
  });

  test.describe("goods", () => {
    test.use({ extraHTTPHeaders: ipHeaders(92) });
    test("goods editor: a price change reflects on the storefront", async ({ page, browser }) => {
      const newPrice = "77";
      await loginAsAdmin(page);
      await goodsTab(page).click();
      await page.locator("[data-goodsq]").fill(PRODUCT_2.id);
      await page.locator(`[data-admgoods="${PRODUCT_2.id}"]`).click();

      try {
        // The price lives on the editor's «Размеры и цены» tab (ED_TABS in app.js).
        await page.locator('[data-edtab="sizes"]').click();
        await page.locator("[data-edprice]").fill(newPrice);
        await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
        await expect(page.getByRole("status")).toBeVisible();

        // A separate, logged-out storefront visit in its own browser context
        // — not just a new page — see freshStorefrontPage()'s own comment.
        const storefront = await freshStorefrontPage(browser);
        await storefront.page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
        await waitForScreen(storefront.page, "product");
        await expect(storefront.page.locator("[data-price]")).toHaveText(eur(Number(newPrice), "RU"));
        await storefront.close();
      } finally {
        // Clear the override — PUT {price:null} "hands the field back to the
        // catalogue" (src/app/api/admin/overrides/route.ts) — via the same UI
        // a real admin would use, not a raw API call, so this is still real
        // coverage of the editor rather than a side-door cleanup. PRODUCT_2's
        // baseline price (fixtures.ts) is what the catalogue itself holds.
        await goodsTab(page).click();
        await page.locator("[data-goodsq]").fill(PRODUCT_2.id);
        await page.locator(`[data-admgoods="${PRODUCT_2.id}"]`).click();
        await page.locator('[data-edtab="sizes"]').click();
        await page.locator("[data-edprice]").fill(String(PRODUCT_2.price));
        await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
      }
    });
  });

  test.describe("hero", () => {
    test.use({ extraHTTPHeaders: ipHeaders(93) });
    test("hero editor saves a change, then resets to the default", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSettings(page);

      try {
        await page.locator('[data-heroedit="0"]').click();
        await page.locator('[data-herof="title"]').fill("E2E hero title");
        await page.locator("[data-herosave]").click();
        await expect(page.locator("[data-admapply]")).toBeVisible();
        await applyAndWaitForSettingsWrite(page);
        await expect(page.getByRole("status")).toBeVisible();

        const home = await freshStorefrontPage(browser);
        await home.page.goto(shopUrl("", "/"));
        await waitForScreen(home.page, "home");
        await expect(home.page.getByText("E2E hero title")).toBeVisible();
        await home.close();
      } finally {
        await openSettings(page);
        await page.locator("[data-heroreset]").click();
        await expect(page.locator("[data-admapply]")).toBeVisible();
        await page.locator("[data-admapply]").click();
      }
    });
  });

  test.describe("content", () => {
    test.use({ extraHTTPHeaders: ipHeaders(94) });
    test("content card saves a change (footer phone), then resets to the default", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSettings(page, "company");

      try {
        // The content card is always rendered on its settings sub-page — no
        // separate "open" step, just expand its "Реквизиты" sub-block (see
        // fixtures/docs/testing.md on why nothing here waits on a "Контент"
        // heading click).
        await page.locator('[data-contentblock="company"]').click();
        await page.locator('[data-contentf="company.phone"]').fill("+372 5000000");
        await page.locator("[data-contentsave]").click();
        await expect(page.locator("[data-admapply]")).toBeVisible();
        await applyAndWaitForSettingsWrite(page);
        await expect(page.getByRole("status")).toBeVisible();

        const home = await freshStorefrontPage(browser);
        await home.page.goto(shopUrl("", "/"));
        await waitForScreen(home.page, "home");
        for (const summary of await home.page.locator(".ftr .ftr__acc summary").all()) await summary.click();
        await expect(home.page.getByText("+372 5000000")).toBeVisible();
        await home.close();
      } finally {
        await openSettings(page, "company");
        await page.locator('[data-contentblock="company"]').click();
        await page.locator("[data-contentreset]").click();
        await expect(page.locator("[data-admapply]")).toBeVisible();
        await page.locator("[data-admapply]").click();
      }
    });
  });

  test.describe("promos", () => {
    test.use({ extraHTTPHeaders: ipHeaders(95) });
    test("promo tab: a new code works at checkout", async ({ page, context }) => {
      const code = "E2EPROMO" + Date.now().toString().slice(-6);
      await loginAsAdmin(page);
      await page.locator('[data-admtab="promos"][aria-current]:visible').first().click();
      await page.locator("[data-admpromonew]").click();
      await page.locator('[data-promof="code"]').fill(code);
      // the kind is a chip row since the redesign, not a radio list
      await page.locator('[data-promokind="percent"]').click();
      await page.locator('[data-promof="value"]').fill("10");
      await page.locator("[data-admpromosave]").click();
      await expect(page.getByText(code)).toBeVisible();

      const shopper = await context.newPage();
      await shopper.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
      await waitForScreen(shopper, "product");
      await shopper.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
      await expect(shopper.getByRole("status")).toBeVisible();
      await shopper.goto(shopUrl("", "/checkout/"));
      await waitForScreen(shopper, "checkout");
      await shopper.locator("[data-email]").fill(freshEmail("promo-redeem"));
      await continueButton(shopper, 2).click();
      await shopper.locator("[data-promo]").fill(code);
      await shopper.locator("[data-applypromo]").click();
      // promoRowHTML() (app.js) renders a [data-promooff] "remove" button only
      // once a promo is actually applied — the definitive "discount shown" signal.
      await expect(shopper.locator("[data-promooff]")).toBeVisible();
      await shopper.close();
    });
  });

  test.describe("sets toggle", () => {
    test.use({ extraHTTPHeaders: ipHeaders(96) });
    test("sets toggle hides the rail, then is switched back on", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSettings(page);

      try {
        await toggleAndWait(page, "[data-admbundles]");
        await expect(page.getByRole("status")).toBeVisible();

        const home = await freshStorefrontPage(browser);
        await home.page.goto(shopUrl("", "/"));
        await waitForScreen(home.page, "home");
        await expect(home.page.locator(".sec--bundles")).toHaveCount(0);
        await home.close();
      } finally {
        await openSettings(page);
        /* Put the switch back on if it is off, whatever happened above. And
           wait for the WRITE, not just the click: the panel applies the switch
           locally and PUTs it in the background, so a test that ends on the
           click has its context torn down with the request still in flight —
           the switch stayed off on the server and the next spec file found a
           shop with no sets in it (and this very test, run again, toggled sets
           back ON and then asserted the rail was gone). */
        if (!(await isOn(page, "[data-admbundles]"))) await toggleAndWait(page, "[data-admbundles]");
      }
    });
  });

  test.describe("chatbot toggle", () => {
    test.use({ extraHTTPHeaders: ipHeaders(97) });
    test("chatbot toggle hides the FAB, then is switched back on", async ({ page, browser }) => {
      await loginAsAdmin(page);
      await openSettings(page);

      try {
        await toggleAndWait(page, "[data-admchatbot]");
        await expect(page.getByRole("status")).toBeVisible();

        const home = await freshStorefrontPage(browser);
        await home.page.goto(shopUrl("", "/"));
        await waitForScreen(home.page, "home");
        await expect(home.page.getByRole("button", { name: "Чат с помощником" })).toHaveCount(0);
        await home.close();
      } finally {
        await openSettings(page);
        if (!(await isOn(page, "[data-admchatbot]"))) await toggleAndWait(page, "[data-admchatbot]");
      }
    });
  });
});
