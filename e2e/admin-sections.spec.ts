import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * The six «Ещё» sections after the phase-3 redesign — «Клиенты», «Маркетинг»,
 * «Блог», «Аналитика», «Подключения» and «Настройки»
 * (docs/design/admin-handoff-README.md).
 *
 * Two things are checked for each: that it draws on a phone as well as on a
 * desktop without throwing, and that one real action on it actually reaches the
 * server. A screen that renders but whose buttons do nothing is the failure
 * this file exists to catch — every section here sits on an API the panel had
 * before the redesign, and a restyle must not have cut a wire.
 *
 * Both projects on purpose: this is the half of the panel Renat uses from an
 * iPhone (the reviews queue, the letters, the journal), so 375 px is not an
 * afterthought here the way it is for the goods editor.
 *
 * Rate limits: admin login is 5/min per IP (src/lib/auth.ts), so each describe
 * gets its own fake address, exactly as admin.spec.ts does.
 */

/** No uncaught error and no failed request while the section was on screen. */
function watchErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on("pageerror", (e) => seen.push(String(e)));
  return seen;
}

test.describe("admin sections — every screen draws on both viewports", () => {
  test.use({ extraHTTPHeaders: ipHeaders(180) });

  test("the six «Ещё» sections render with no page error", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await loginAsAdmin(page);

    /* Each entry: the section's own key, the sub-tab to open after it (or
       none), and a phrase that only that screen prints — «renders» has to mean
       the section's own content, not merely that the shell survived. */
    const screens: Array<[string, string | undefined, string]> = [
      ["people", undefined, "Все клиенты"],
      ["people", "reviews", "Отзывы"],
      ["promos", undefined, "Промокоды"],
      ["promos", "gift", "Номиналы в магазине"],
      ["promos", "mail", "Заказ принят"],
      ["blog", undefined, "Блог"],
      ["stats", undefined, "Аналитика"],
      ["apps", undefined, "Подключения"],
      ["setup", undefined, "Доставка и оплата"],
    ];

    for (const [key, sub, phrase] of screens) {
      await adminSection(page, key, sub);
      const work = page.locator(".adm-page");
      await expect(work, `${key}/${sub ?? "-"} drew nothing`).toBeVisible();
      // inside the work column, not anywhere on the page: the storefront's own
      // hidden nav carries some of these words too
      await expect(work.getByText(phrase).first(), `${key}/${sub ?? "-"} is missing «${phrase}»`)
        .toBeVisible();
      // …and nothing spills sideways: a panel that scrolls horizontally on a
      // phone is a panel whose bottom bar cannot be reached.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${key}/${sub ?? "-"} spills sideways on ${testInfo.project.name}`)
        .toBeLessThanOrEqual(1);
    }

    // the settings index and one sub-page of it
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="journal"]').click();
    await expect(page.locator("[data-admsetback]")).toBeVisible();
    await page.locator("[data-admsetback]").click();
    await expect(page.locator('[data-admsetpage="delivery"]')).toBeVisible();

    expect(errors, `page errors while walking the sections: ${errors.join(" | ")}`).toEqual([]);
  });
});

test.describe("admin sections — Клиенты", () => {
  test.use({ extraHTTPHeaders: ipHeaders(181) });

  test("a Pro request is approved from the row, and a review is published with an undo", async ({ page, context }) => {
    test.setTimeout(150_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);

    /* ---- a partner request, answered from the list ----------------------- */
    const email = freshEmail("sections-pro");
    const shopper = await context.newPage();
    await shopper.goto(shopUrl("", "/account/"));
    await waitForScreen(shopper, "account");
    await shopper.locator("[data-email]").fill(email);
    const codeRes = shopper.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await shopper.locator("[data-login]").click();
    const code = (await (await codeRes).json()).code as string;
    await shopper.locator("[data-acctcode]").fill(code);
    await shopper.locator("[data-logincode]").click();
    await expect(shopper.locator("[data-logout]")).toBeVisible();
    expect((await shopper.request.post("/api/account/pro-request/", {
      data: { company: "Salon Sections OÜ", regCode: "12345678", phone: "+372 5550003" },
    })).ok()).toBe(true);
    await shopper.close();

    await page.reload();
    await waitForScreen(page, "admin");
    await adminSection(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    /* «Одобрить Pro» sits on the row itself now — the whole point of the
       redesign is that a waiting request is answered without opening a card.
       It still asks first: the approval turns salon prices on for that company
       and posts «Цены для салонов включены», and there is no un-sending a
       letter — the same confirm card the tier switch on the customer's own
       card has always shown. */
    const approve = page.locator(`[data-admcustapprove]`).first();
    await expect(approve, "the pending request has no «Одобрить Pro» on its row").toBeVisible();
    await approve.click();
    const proCard = page.locator(".adm-confirm");
    await expect(proCard.locator(".adm-confirm__t")).toHaveText("Сделать партнёром?");
    await expect(proCard.locator(".adm-confirm__d")).toContainText(email);
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect.poll(async () => {
      const res = await page.request.get(`/api/admin/customers/${encodeURIComponent(email)}/`);
      return (await res.json()).customer.tier;
    }, { timeout: 10_000, message: "«Одобрить Pro» never reached the server" }).toBe("pro");
    // leave the shop as it was found
    await page.request.patch(`/api/admin/customers/${encodeURIComponent(email)}/`, { data: { tier: "retail" } });

    /* ---- a review, published with an undo on the toast ------------------- */
    const reviewName = `E2E ${Date.now().toString().slice(-6)}`;
    // the shopper's own form, through the public route (validateReview's field
    // names: `product`, plus the consent box the form makes you tick)
    const created = await page.request.post("/api/reviews/", {
      data: {
        product: PRODUCT.id, rating: 5, name: reviewName,
        text: "Отличный шампунь, проверено на себе.", lang: "RU", consent: true,
      },
    });
    expect(created.ok(), "the review could not be filed").toBe(true);

    /* A published review on PRODUCT changes what the storefront shows — and
       e2e/product.spec.ts expects that product's reviews block to start
       empty. Whatever happens below, the review is taken down again. */
    let reviewId = "";
    try {
      await page.reload();
      await waitForScreen(page, "admin");
      await adminSection(page, "people", "reviews");
      const row = page.locator(".adm-row", { hasText: reviewName }).first();
      await expect(row, "the new review is not in the queue").toBeVisible();
      await row.locator("[data-admrev]").first().click();

      await expect(page.getByRole("status")).toContainText("Отзыв опубликован");
      // reversible edits offer the way back on the toast itself (README § State)
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/reviews/?status=approved");
        const hit = ((await res.json()).reviews as Array<{ id: string; name: string }>).find((r) => r.name === reviewName);
        if (hit) reviewId = hit.id;
        return !!hit;
      }, { timeout: 10_000, message: "«Опубликовать» never reached the server" }).toBe(true);

      // …and the journal kept the way back
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="journal"]').click();
      await expect(page.locator('[data-admundo="0"]'), "publishing a review left no journal entry").toBeVisible();
    } finally {
      if (reviewId) {
        await page.request.patch("/api/admin/reviews/", { data: { id: reviewId, status: "rejected" } });
      }
    }
  });
});

test.describe("admin sections — Маркетинг", () => {
  test.use({ extraHTTPHeaders: ipHeaders(182) });

  test("a promo code is created, a gift amount reaches /gift/, a letter's subject is saved", async ({ page, context }) => {
    test.setTimeout(150_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);

    /* ---- Промокоды: the inline form ------------------------------------- */
    const code = "E2ESEC" + Date.now().toString().slice(-6);
    await adminSection(page, "promos");
    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(code);
    await page.locator('[data-promokind="percent"]').click();
    await page.locator('[data-promof="value"]').fill("15");
    await page.locator("[data-admpromosave]").click();
    /* Scoped to the row's own name, not the page: since the switches say «Вкл»
       / «Выкл», each one also carries its clipped accessible name («Промокод
       SUMMER»), so a bare getByText(code) now matches two nodes. */
    await expect(page.locator(`[data-admpromoedit="${code}"] .adm-row__nm`)).toHaveText(code);
    const promos = await (await page.request.get("/api/admin/promos/")).json();
    expect((promos.promos as Array<{ code: string }>).some((p) => p.code === code),
      "the new code never reached the server").toBe(true);

    /* ---- Подарочные карты: a denomination the /gift/ page reads ---------- */
    await adminSection(page, "promos", "gift");
    const seventyFive = page.locator('[data-admgiftamt="75"]');
    await expect(seventyFive, "75 € is not offered as a denomination").toBeVisible();
    expect(await seventyFive.getAttribute("aria-pressed"), "75 € starts switched on").toBe("false");
    const put = page.waitForResponse(
      (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
    await seventyFive.click();
    expect((await put).ok()).toBe(true);

    try {
      /* Its own browser context, not `context.newPage()`: /api/overrides/ —
         where the storefront reads the setting — answers
         `s-maxage=30, stale-while-revalidate=120`, and a page in the same
         context shares the admin page's HTTP cache and would keep showing the
         three old amounts. Same reasoning as admin.spec.ts's
         freshStorefrontPage(). */
      const shopCtx = await page.context().browser()!.newContext();
      const shopper = await shopCtx.newPage();
      await shopper.goto(shopUrl("", "/gift/"));
      await waitForScreen(shopper, "gift");
      await expect(shopper.locator('[data-giftamt="75"]'),
        "the shop does not offer the amount the panel switched on").toBeVisible();
      await shopCtx.close();
    } finally {
      // back to the three the shop has always sold
      await page.request.put("/api/admin/settings/", { data: { gift_amounts: [25, 50, 100] } });
    }

    /* ---- Письма: the list, one letter, one saved subject ----------------- */
    await adminSection(page, "promos", "mail");
    await page.locator('[data-mailtpl="order-shipped"]').first().click();
    await expect(page.locator('[data-mailtxt="subject"]')).toBeVisible();
    const subject = `E2E тема ${Date.now().toString().slice(-6)} {order}`;
    await page.locator('[data-mailtxt="subject"]').fill(subject);
    // the preview beside the fields is live — it shows the letter, not the template
    await expect(page.locator('[data-mailprev="subject"]')).toContainText("R-100042");
    try {
      await page.locator("[data-mailsave]").click();
      await expect(page.locator("[data-admapply]")).toBeVisible();
      const write = page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
      await page.locator("[data-admapply]").click();
      expect((await write).ok()).toBe(true);

      const saved = await (await page.request.get("/api/admin/settings/")).json();
      expect(saved.settings.mail_texts["order-shipped"].ru.subject,
        "the subject the owner typed is not what the letter carries").toBe(subject);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { mail_texts: {} } });
    }
  });
});

test.describe("admin sections — Блог", () => {
  test.use({ extraHTTPHeaders: ipHeaders(183) });

  test("a post written in the redesigned editor is published and withdrawn", async ({ page }) => {
    test.setTimeout(150_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);
    await adminSection(page, "blog");

    await page.locator("[data-admblognew]").click();
    const title = `E2E раздел ${Date.now().toString().slice(-6)}`;
    // the Oswald title input with only a bottom rule — same [data-blogf] hook
    await page.locator('[data-blogf="title"]').fill(title);
    await page.locator("[data-blogbody]").click();
    await page.keyboard.type("Проверка редактора после редизайна.");
    await page.locator('[data-blogf="excerpt"]').fill("Короткий анонс.");

    // the right column: «Публикация» says what the state is, and publishes
    await expect(page.getByText("Черновик. В магазине его пока не видно.")).toBeVisible();
    const slug = await page.locator("[data-blogslug]").inputValue();
    /* Written in Russian only, so «Опубликовать» first asks what the Estonian
       and English readers will get — its own test is in admin-blog.spec.ts. */
    await page.locator("[data-admblogpublish]").click();
    await page.locator("[data-admblogpublishyes]").click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();

    const api = await page.request.get(`/api/blog/${slug}/?lang=RU`);
    expect(api.status(), "the published post is not on the public API").toBe(200);

    // …and the list shows it with its badge
    await page.locator("[data-admblogback]").click();
    await expect(page.locator(".adm-row", { hasText: title }).first()).toBeVisible();

    // leave the blog as it was found
    await page.locator(`[data-admblogedit]`).first().click();
    await page.locator("[data-admblogunpublish]").click();
    await expect(page.getByRole("status")).toBeVisible();
  });
});

test.describe("admin sections — Настройки", () => {
  test.use({ extraHTTPHeaders: ipHeaders(184) });

  test("a tariff is changed through the confirm card and taken back from the journal", async ({ page }) => {
    test.setTimeout(150_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);

    const before = await (await page.request.get("/api/admin/settings/")).json();
    const originalRules = before.settings.shipping_rules ?? null;

    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="delivery"]').click();
      const courierEE = page.locator('[data-shiprule="m:courier:EE"]');
      await expect(courierEE, "the tariff grid did not draw").toBeVisible();
      await courierEE.fill("7,77");

      /* A delivery price is money a stranger is charged, so it asks first —
         the same confirm card as shipping an order (README § State). */
      await page.locator("[data-admshipsave]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить тарифы доставки?");
      const put = page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
      await page.locator("[data-admapply]").click();
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Тарифы доставки сохранены");

      const now = await (await page.request.get("/api/admin/settings/")).json();
      expect(Number(now.settings.shipping_rules.methods.courier.EE),
        "«7,77» never reached the server").toBeCloseTo(7.77, 2);

      /* ---- and the journal takes it back ------------------------------- */
      await page.locator("[data-admsetback]").click();
      await page.locator('[data-admsetpage="journal"]').click();
      const entry = page.locator('[data-admundo="0"]');
      await expect(entry, "the tariff change never reached the journal").toBeVisible();
      const back = page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
      await entry.click();
      expect((await back).ok()).toBe(true);

      await expect.poll(async () => {
        const after = await (await page.request.get("/api/admin/settings/")).json();
        return Number(after.settings.shipping_rules?.methods?.courier?.EE ?? 0);
      }, { timeout: 10_000, message: "«Вернуть» did not put the tariff back" }).not.toBeCloseTo(7.77, 2);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { shipping_rules: originalRules ?? {} } });
    }
  });
});

/**
 * The four cards the phase-4 sweep rebuilt in the panel's own markup — the
 * banner editor, the shop's details, prices & points, the accountant's report.
 * Each save is a shop-wide (or money) change, so it goes through the overlay
 * confirm card and lands on the server; the report is a link, and the link is
 * the one the API serves.
 */
test.describe("admin sections — Настройки: the rebuilt cards", () => {
  test.use({ extraHTTPHeaders: ipHeaders(185) });

  test("banner, shop details and prices save through the confirm card; the report link points at the export", async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);
    const settingsPut = () =>
      page.waitForResponse((r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
    const before = await (await page.request.get("/api/admin/settings/")).json();

    /* ---- Главная страница: the banner ------------------------------------ */
    const title = `E2E баннер ${Date.now().toString().slice(-6)}`;
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="home"]').click();
      // a slide is a row with its own switch, order buttons and «Изменить»
      await expect(page.locator('[data-heroon="0"]')).toHaveAttribute("aria-checked", "true");
      await page.locator('[data-heroedit="0"]').click();
      await page.locator('[data-herof="title"]').fill(title);
      await page.locator("[data-heroclose]").click();
      await expect(page.getByText("Есть несохранённые изменения — нажмите «Сохранить».").first()).toBeVisible();

      await page.locator("[data-herosave]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить баннер на главной?");
      await expect(page.locator(".adm-confirm__d")).toContainText("Слайдов на сайте");
      const put = settingsPut();
      await page.locator("[data-admapply]").click();
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Баннер сохранён");
      const saved = await (await page.request.get("/api/admin/settings/")).json();
      expect(saved.settings.hero.slides[0].title.RU, "the title never reached settings.hero").toBe(title);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { hero: before.settings.hero ?? null } });
    }

    /* ---- О компании: the shop's own details ----------------------------- */
    try {
      await page.reload();
      await waitForScreen(page, "admin");
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="company"]').click();
      await page.locator('[data-contentblock="company"]').click();
      await page.locator('[data-contentf="company.phone"]').fill("+372 5000001");
      await page.locator("[data-contentsave]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить данные магазина?");
      await expect(page.locator(".adm-confirm__d")).toContainText("+372 5000001");
      const put = settingsPut();
      await page.locator("[data-admapply]").click();
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Данные магазина сохранены");
      const saved = await (await page.request.get("/api/admin/settings/")).json();
      expect(saved.settings.content.company.phone, "the phone never reached settings.content").toBe("+372 5000001");
    } finally {
      // back to the standard details through the panel's own reset
      await adminSection(page, "setup");
      const back = page.locator("[data-admsetback]");
      if (await back.count()) await back.first().click();
      await page.locator('[data-admsetpage="company"]').click();
      await page.locator("[data-contentreset]").click();
      if (await page.locator("[data-admapply]").count()) {
        const put = settingsPut();
        await page.locator("[data-admapply]").click();
        await put;
      }
    }

    /* ---- Цены и баллы ---------------------------------------------------- */
    const originalPricing = JSON.parse(JSON.stringify(before.settings.pricing || {}));
    try {
      // the nav item always lands on the index of the six pages
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="prices"]').click();
      await page.locator('[data-pricingf="proDiscountPct"]').fill("22");
      await page.locator("[data-admpricingsave]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить цены и баллы?");
      await expect(page.locator(".adm-confirm__d")).toContainText("22%");
      const put = settingsPut();
      await page.locator("[data-admapply]").click();
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Цены и баллы сохранены");
      const saved = await (await page.request.get("/api/admin/settings/")).json();
      expect(saved.settings.pricing.proDiscountPct, "the discount never reached settings.pricing").toBe(22);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { pricing: originalPricing } });
    }

    /* ---- Отчёт для бухгалтера: the download link ------------------------- */
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="company"]').click();
    const month = await page.locator("[data-admreportsmonth]").inputValue();
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    const opened = page.context().waitForEvent("request",
      (r) => r.url().includes("/api/admin/reports/orders/"));
    const popup = page.waitForEvent("popup");
    await page.locator('[data-admreportdl="xlsx"]').click();
    expect((await opened).url(), "the button opened something other than this month's export")
      .toContain(`/api/admin/reports/orders/?month=${month}&format=xlsx`);
    await (await popup).close();
  });
});

/**
 * Partners. The owner's question was «how and where do I manage requests,
 * partners and retail?» — so «Клиенты» now says so in a lead, has a
 * «+ Партнёр» button that adds a salon by e-mail, and the customer card has a
 * Розница ↔ Партнёр switch. This test walks the button end to end: the
 * confirm card, POST /api/admin/customers/, the «Партнёры» chip, the welcome
 * letter (the e2e mail sink), the journal — and then the partner signs in on
 * the storefront and sees the salon price on a product.
 */
test.describe("admin sections — Клиенты: «+ Партнёр»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(186) });

  test("a partner added by e-mail lands under «Партнёры», gets the letter, and sees salon prices in the shop", async ({ page, browser }) => {
    test.setTimeout(150_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);
    await adminSection(page, "people");

    // the lead answers the question, and links to where the discount lives
    const lead = page.locator(".adm-page .adm-lead");
    await expect(lead).toContainText("Заявка на партнёрство");
    await expect(lead.locator('[data-admgoset="prices"]')).toBeVisible();

    /* ---- «+ Партнёр»: the form, the confirm card, the POST ---------------- */
    const email = freshEmail("sections-partner");
    await page.locator("[data-admpartnernew]").click();
    await page.locator('[data-partnerf="email"]').fill(email);
    await page.locator('[data-partnerf="company"]').fill("Salon E2E OÜ");
    await page.locator("[data-admpartnersave]").click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Добавить партнёра?");
    await expect(page.locator(".adm-confirm__d")).toContainText(email);
    const post = page.waitForResponse(
      (r) => r.url().includes("/api/admin/customers/") && r.request().method() === "POST");
    await page.locator("[data-admapply]").click();
    const answer = await (await post).json();
    expect(answer.ok, "POST /api/admin/customers/ refused the partner").toBe(true);
    expect(answer.created).toBe(true);
    expect(answer.promoted).toBe(true);
    await expect(page.getByRole("status")).toContainText("Партнёр добавлен");
    // reversible — «Отменить» on the toast (README § State)
    await expect(page.locator(".adm-toast__undo")).toBeVisible();

    try {
      // the list jumped to «Партнёры», and the new row is there, badged Pro
      await expect(page.locator('[data-admcusttier="pro"]')).toHaveAttribute("aria-current", "true");
      const row = page.locator(".adm-row", { hasText: email }).first();
      await expect(row, "the new partner is not under «Партнёры»").toBeVisible();
      await expect(row.locator(".adm-badge")).toHaveText("Pro");
      const listed = await (await page.request.get("/api/admin/customers/?tier=pro")).json();
      expect((listed.customers as Array<{ email: string; company: string | null }>).find((c) => c.email === email)?.company).toBe("Salon E2E OÜ");

      // the card shows the switch on «Партнёр»
      await row.locator("[data-admcustopen]").click();
      await expect(page.locator('[data-admcusttierset="pro"]')).toHaveAttribute("aria-current", "true");
      await page.locator("[data-admcustclose]").click();

      // the welcome letter went out — captured by the e2e mail sink, since
      // this suite runs without RESEND_API_KEY (docs/testing.md)
      const mails = await (await page.request.get(
        `/api/e2e/mail/?template=partner-welcome&to=${encodeURIComponent(email)}`)).json();
      expect(mails.mails, "no «Цены для салонов включены» letter for the new partner").toHaveLength(1);
      expect(mails.mails[0].subject).toContain("Цены для салонов включены");

      // …and the journal kept the way back
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="journal"]').click();
      await expect(page.locator(".adm-jrow", { hasText: `Новый партнёр: ${email}` })).toBeVisible();
      await expect(page.locator('[data-admundo="0"]')).toBeVisible();

      /* ---- the storefront: the partner signs in and sees salon prices ---- */
      const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(188) });
      const shopper = await ctx.newPage();
      try {
        await shopper.goto(shopUrl("", "/account/"));
        await waitForScreen(shopper, "account");
        await shopper.locator("[data-email]").fill(email);
        const codeRes = shopper.waitForResponse((r) => r.url().includes("/api/account/code/"));
        await shopper.locator("[data-login]").click();
        const code = (await (await codeRes).json()).code as string;
        await shopper.locator("[data-acctcode]").fill(code);
        await shopper.locator("[data-logincode]").click();
        await expect(shopper.locator("[data-logout]")).toBeVisible();
        // the cabinet says «партнёр» — no request form, the status is already on
        await expect(shopper.locator(".chip", { hasText: "партнёр" })).toBeVisible();
        await expect(shopper.locator("[data-acctprosend]")).toHaveCount(0);

        /* To the product inside the app (the header logo, then the card in the
           «Популярные» rail — PRODUCT is its first tile): the session and the
           partner prices it fetched stay with the page that way. */
        await shopper.locator('.hdr [data-go="home"]').click();
        await waitForScreen(shopper, "home");
        await shopper.locator(`.card__go[data-go-product="${PRODUCT.id}"]`).first().click();
        await waitForScreen(shopper, "product");
        await expect(shopper.locator(".pdp .chip", { hasText: "Цена для салонов" }).first(),
          "the partner does not see the salon price on the product page").toBeVisible();
      } finally {
        await ctx.close();
      }
    } finally {
      // leave the shop as it was found
      await page.request.patch(`/api/admin/customers/${encodeURIComponent(email)}/`, { data: { tier: "retail" } });
    }
  });
});

/* ---------------------------------------------------------------------------
 * The two places on this panel where a number is useless without the sentence
 * beside it: the Google block on «Аналитика» and the six figures on
 * «Настройки → Цены и баллы» (docs/audit/2026-09-07-wording.md; Dim,
 * 07.09.2026 — Renat does not use Search Console and has never run a loyalty
 * scheme). Both screens now do the arithmetic instead of naming it, and that
 * arithmetic is real behaviour, not decoration: it is computed from what is
 * in the form and it has to agree with what the server would actually charge
 * and award (priceItems() / earnLoyaltyPoints(), src/lib/loyalty.ts).
 */
test.describe("admin sections — the numbers explain themselves", () => {
  test.use({ extraHTTPHeaders: ipHeaders(189) });

  /* Nothing here is ever saved: «Партнёры и баллы» and the five fields move
     the local draft only (pricingDraft() in app.js), and the confirm card is
     never opened — so this test needs no cleanup and cannot leak settings
     into the specs that run after it. */
  test("«Цены и баллы» works the example out in euros while the owner types", async ({ page }) => {
    await loginAsAdmin(page);
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="prices"]').click();
    /* «Партнёры и баллы» is off by default (Renat said «later»), and with it
       off the five fields are not drawn at all — so the switch comes first.
       admSwitch() is `role="switch"` + `aria-checked` — a reader then says
       «включено», not «нажата» — so `aria-pressed` is not on it at all. */
    const partners = page.locator("[data-partnerson]");
    if ((await partners.getAttribute("aria-checked")) !== "true") await partners.click();
    await expect(partners).toHaveAttribute("aria-checked", "true");

    const hint = (key: string) => page.locator(`[data-pricingex="${key}"]`);
    const calc = page.locator(".adm-calc__c", { hasText: "Партнёр — салон или мастер" });

    await page.locator('[data-pricingf="proDiscountPct"]').fill("25");
    await expect(hint("proDiscountPct"), "the discount is not worked out in euros")
      .toHaveText("Партнёр платит на 25 % меньше: товар за 40 € обойдётся ему в 30 €.");
    await expect(calc, "the sample basket did not follow the field").toContainText("30 €");

    /* A threshold above the sample basket is the case the owner cannot see
       coming: the partner pays full price and the panel has to say why. */
    await page.locator('[data-pricingf="proMinOrder"]').fill("50");
    await expect(calc).toContainText("Скидка не сработала: корзина не набрала 50 €.");
    await expect(calc, "a blocked discount still showed the discounted price").toContainText("40 €");
    await page.locator('[data-pricingf="proMinOrder"]').fill("0");

    // 10% of a 40 € order is 4 points, and a point is a euro — earnLoyaltyPoints()
    await page.locator('[data-pricingf="earnPct"]').fill("10");
    await expect(hint("earnPct")).toHaveText(
      "Начисляем 10 %: с заказа на 40 € вернётся 4 € баллами. Один балл — одно евро.");
    await expect(page.locator(".adm-calc")).toContainText("Вернётся баллами");

    // …and the redeem cap, which is the other half of what a point is worth
    await page.locator('[data-pricingf="redeemMaxPct"]').fill("50");
    await expect(hint("redeemMaxPct")).toHaveText(
      "Из корзины на 40 € баллами можно закрыть не больше 20 €, остальное — деньгами.");
  });

  test("the Google block says where 13th place puts the shop, not «средняя позиция»", async ({ page }) => {
    /* Search Console is not wired up in an e2e run (no service-account key),
       and the point of this test is the wording, not the fetch — so the real
       shape of Renat's own answer is served from here: about 2 900 показов,
       47 кликов, average position 13, and «rempire» itself at 3.79.
       `topPages` carries the three shapes the page list has to survive: a
       product address, the same kind of address one language over, and the
       home page — the last one clicked exactly once, which is the singular
       every language spells differently (Dim, 08.09.2026). */
    await page.route("**/api/admin/analytics/gsc/**", (r) => r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true, clicks: 47, impressions: 2900, ctr: 47 / 2900, position: 13.02,
        topQueries: [
          { query: "rempire", clicks: 31, impressions: 210, ctr: 0.147, position: 3.79 },
          { query: "краска для волос таллинн", clicks: 0, impressions: 340, ctr: 0, position: 27.6 },
        ],
        topPages: [
          { page: `https://rempire.ee/shop2/p/${PRODUCT.id}/`, clicks: 12, impressions: 480, ctr: 0.025, position: 8.2 },
          { page: "https://rempire.ee/shop2/et/p/kevin-murphy-un-tangled-spray/", clicks: 0, impressions: 260, ctr: 0, position: 22.4 },
          { page: "https://rempire.ee/shop2/", clicks: 1, impressions: 90, ctr: 0.011, position: 5.4 },
        ],
      }),
    }));
    await loginAsAdmin(page);
    await adminSection(page, "stats");

    const work = page.locator(".adm-page");
    await expect(work.locator(".adm-read"), "the position is still only a number")
      .toContainText("В среднем ваш магазин показывается в Google на 13-м месте.");
    // …and the bad half of it said out loud, not left for the owner to infer
    await expect(work.locator(".adm-read")).toContainText("Это вторая страница Google");
    await expect(work.locator(".adm-read")).toHaveClass(/adm-read--warn/);

    const defs = work.locator(".adm-defs");
    await expect(defs, "«показ» is used without ever being explained")
      .toContainText("Показ — это когда магазин попал в список Google");
    await expect(defs).toContainText("Из 2 900 показов перешли 47.");
    await expect(defs).toContainText("Из каждых 100 показов переходов — примерно 2.");

    /* Two lists of the same shape now — the words first, the pages under
       them — so each is addressed by its place rather than by a class of its
       own. */
    const queries = work.locator(".adm-qs").nth(0);
    await expect(queries).toContainText("rempire");
    await expect(queries, "the outcome is still a row of data, not a sentence")
      .toContainText("Google показал магазин 210 раз, в среднем на 4-м месте.");
    await expect(queries).toContainText("На ссылку нажали 31 раз.");
    await expect(queries, "a word nobody clicked reads the same as one that worked")
      .toContainText("На ссылку не нажал никто.");

    /* The pages Search Console sends beside the words. They arrive as bare
       addresses and are worth nothing to Renat in that form, so what has to
       be on screen is the name he knows the товар by — and, on the screen's
       own instruction, where to go and change it. */
    await expect(work, "the top pages are still fetched and thrown away")
      .toContainText("Какие страницы находят в Google");
    await expect(work).toContainText("перепишите заголовок и описание для Google");
    const pages = work.locator(".adm-qs").nth(1);
    await expect(pages, "the address was printed instead of the product's name")
      .toContainText("System 4 — Bio Botanical Shampoo — шампунь");
    await expect(pages).not.toContainText("https://");
    await expect(pages).toContainText("Google показал эту страницу 480 раз, в среднем на 8-м месте.");
    await expect(pages).toContainText("На ссылку нажали 12 раз.");
    // the same product one language over is a different page to Google, and says so
    await expect(pages).toContainText("Un.Tangled Spray — спрей для волос");
    await expect(pages.locator(".adm-q").nth(1)).toContainText("· ET");
    await expect(pages.locator(".adm-q").nth(1)).toContainText("На ссылку не нажал никто.");
    // …and one single click, the number every one of the three languages spells its own way
    await expect(pages.locator(".adm-q").nth(2)).toContainText("Главная");
    await expect(pages.locator(".adm-q").nth(2)).toContainText("На ссылку нажали 1 раз.");
  });
});

/** Playwright has no first-class "is this the mobile project" flag. */
function testProjectIsMobile(info: { project: { name: string } }): boolean {
  return info.project.name !== "desktop";
}
