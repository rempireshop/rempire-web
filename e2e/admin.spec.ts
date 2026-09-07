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

/** A switch is a <button role="switch" aria-checked>, not a link whose label
 *  flips — and since 07.09.2026 it also wears the word «Вкл» / «Выкл». */
async function isOn(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).getAttribute("aria-checked")) === "true";
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
    test("the order card: label → shipped (with the letter) → delivered, and the journal walks every step back", async ({ page }) => {
      test.setTimeout(120_000);
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
      // the 4-step fulfilment strip: «Оплачен» done, «Этикетка» is the step to do
      await expect(page.locator(".adm-step--done")).toHaveCount(1);
      await expect(page.locator(".adm-step--now")).toContainText("Этикетка");
      const status = async () =>
        (await (await page.request.get(`/api/admin/orders/${number}/`)).json()).order.status as string;

      /* «Создать этикетку» registers the parcel (SHIPPING_PROVIDER=mock stands
         in for Montonio — src/lib/shipping/montonio-mock.ts) and changes
         NOTHING else: the owner's complaint was a label button that flipped
         the whole status. It lands in the journal with an undo on the toast. */
      const post = page.waitForResponse((r) => r.url().includes("/api/admin/shipments/") && r.request().method() === "POST");
      await page.locator(".adm-ordacts [data-admlabel]").click();
      expect((await post).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Этикетка готова");
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await page.locator("[data-closetoast]").click();

      await expect(page.locator(".adm-badge--big")).toHaveText("Этикетка готова");
      await expect(page.locator(".adm-step--done")).toHaveCount(2);
      await expect(page.locator(".adm-step--now")).toContainText("Отправлен");
      expect(await status()).toBe("paid");
      // the shipment box: a copyable tracking code, both label sizes — and the A4 one really is a PDF
      const code = ((await page.locator("[data-trackingcode]").textContent()) || "").trim();
      expect(code).toMatch(/^MK\d{9}EE$/);
      await expect(page.locator(`[data-admcopy="${code}"]`)).toBeVisible();
      await expect(page.locator('[data-labelpdf="A6"]')).toHaveAttribute("href", /size=A6/);
      const pdf = await page.request.get((await page.locator('[data-labelpdf="A4"]').getAttribute("href"))!);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");

      /* «Отправлен» moves the status and sends the customer a letter. With a
         label the tracking number is already known and the letter is
         predictable to the word, so since 07.09.2026 (Dim) this applies at
         once with the six-second undo instead of asking — the question stays
         for an order with no label, where the letter would go out with no
         tracking number at all (admin-sweep-4.spec.ts pins both halves). */
      await page.locator(".adm-ordacts [data-admshipnow]").click();
      await expect(page.locator(".adm-confirm__t"), "«Отправлен» still asks when the label exists").toHaveCount(0);
      await expect(page.getByRole("status")).toContainText(`${number} отправлен`);
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await page.locator("[data-closetoast]").click();
      await expect(page.locator(".adm-badge--big")).toHaveText("Отправлен");
      await expect.poll(status).toBe("shipped");

      // the letter went out, with the carrier's tracking link in it (the e2e mail sink, src/lib/mail.ts)
      const sink = async () =>
        (await (await page.request.get(`/api/e2e/mail/?template=order-shipped&to=${encodeURIComponent(email)}`)).json())
          .mails as Array<{ links: string[] }>;
      await expect.poll(async () => (await sink()).length).toBe(1);
      expect((await sink())[0].links.some((l) => l.endsWith(code))).toBe(true);

      /* «Доставлен» — the owner's last step: applied at once, no letter, an
         undo on the toast. */
      await page.locator(".adm-ordacts [data-admdelivered]").click();
      await expect(page.getByRole("status")).toContainText(`${number} доставлен`);
      await page.locator("[data-closetoast]").click();
      await expect(page.locator(".adm-badge--big")).toHaveText("Доставлен");
      await expect(page.locator(".adm-step--done")).toHaveCount(4);
      await expect.poll(status).toBe("delivered");
      expect((await sink()).length).toBe(1);

      /* The journal («Настройки → Журнал») walks it back a step at a time:
         «Вернуть» on the delivered line → shipped, on the shipped line → paid,
         and neither sends the customer anything. */
      await page.locator('[data-admtab="setup"][aria-current]:visible').first().click();
      await page.locator('[data-admsetpage="journal"]').click();
      const undoRow = (text: string) => page.locator(".adm-jrow:has([data-admundo])", { hasText: text }).first();
      await expect(undoRow(`Заказ ${number}: доставлен`)).toBeVisible();
      await undoRow(`Заказ ${number}: доставлен`).locator("[data-admundo]").click();
      await expect.poll(status).toBe("shipped");
      await undoRow(`Заказ ${number}: отправлен`).locator("[data-admundo]").click();
      await expect.poll(status).toBe("paid");
      expect((await sink()).length).toBe(1);
      // the label line is there too — its undo keeps the parcel (Montonio cannot cancel it) and returns the step
      await undoRow(`Этикетка ${number}: создана`).locator("[data-admundo]").click();
      await expect(page.getByRole("status")).toContainText("Отменено");
      await expect(page.locator(".adm-jrow", { hasText: `Этикетка ${number}: создана` })).toHaveCount(0);

      // …and the card agrees: paid again, the «Этикетка» step to do, the parcel set aside but not lost
      await ordersTab(page).click();
      await page.locator('[data-admfilter="new"]').click();
      await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
      await expect(page.locator(".adm-badge--big")).toHaveText("Оплачен");
      await expect(page.locator(".adm-step--now")).toContainText("Этикетка");
      await expect(page.locator(".adm-ship--off")).toContainText("Отправление у Montonio остаётся");
      await expect(page.locator(".adm-ordacts [data-admlabel]")).toHaveText("Создать этикетку");
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
        // The toast is optimistic; the PUT to /api/admin/overrides/ lands after
        // it. The storefront visit below reads the server, so wait for the write.
        const put = page.waitForResponse((r) => r.url().includes("/api/admin/overrides/") && r.request().method() === "PUT");
        await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
        await expect(page.getByRole("status")).toBeVisible();
        expect((await put).ok()).toBe(true);

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
        // …and wait for this write too, or the context is torn down with the
        // request in flight and the next spec file sees the changed price.
        const back = page.waitForResponse((r) => r.url().includes("/api/admin/overrides/") && r.request().method() === "PUT");
        await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
        await back;
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
        // the banner is shop-wide, so «Сохранить» asks first — the overlay
        // card, same as a tariff (README § State)
        await page.locator("[data-herosave]").click();
        await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить баннер на главной?");
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
        // the details reach every page of the shop, so the save asks first
        await page.locator("[data-contentsave]").click();
        await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить данные магазина?");
        await expect(page.locator(".adm-confirm__d")).toContainText("+372 5000000");
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
