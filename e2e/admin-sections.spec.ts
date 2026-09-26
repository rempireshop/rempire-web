import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, cardBack, freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen,
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

/** A fold of a 1a screen (admFoldHTML) — opened, never toggled shut: it
 *  remembers its state for the session, so a second click would close it. */
async function openFold(page: Page, key: string): Promise<void> {
  const head = page.locator(`[data-admfold="${key}"]`).first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

/** Every box left, and nothing still on its way: a test that puts settings
 *  back through the API must not have a queued autosave land after it. */
async function settled(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  const busy = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-admsavest]")).some((el) => el.getAttribute("data-st") === "saving"));
  await expect.poll(busy, { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(600);
  await expect.poll(busy, { timeout: 20_000 }).toBe(false);
}

/** «⋯» of a settings block (admSetMoreHTML) — the rare actions, opened. */
async function openMore(page: Page, key: string): Promise<void> {
  const btn = page.locator(`[data-setmore="${key}"]`).first();
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
}

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
      // the chip only «Клиенты» draws (1a: «Все клиенты» became the «Клиенты · Отзывы» switch)
      ["people", undefined, "Подписаны"],
      ["people", "reviews", "Отзывы"],
      // 1a: the tab says «Промо» on a phone; the screen's one dark button is on both
      ["promos", undefined, "+ Промокод"],
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
    await expect(cardBack(page, "[data-admsetback]", "Настройки")).toBeVisible();
    await cardBack(page, "[data-admsetback]", "Настройки").click();
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
    /* «Сделать партнёром» sits on the row itself — the whole point of the
       redesign is that a waiting request is answered without opening a card.
       1a (Dim, 25.09.2026, q3): it no longer asks. The approval posts «Цены
       для салонов включены» and cannot be taken back on the server, so the
       call itself waits ten seconds with «Вернуть» on the toast; the row
       shows the partner at once. */
    const approve = page.locator(`[data-admcustapprove]`).first();
    await expect(approve, "the pending request has no «Сделать партнёром» on its row").toBeVisible();
    await approve.click();
    await expect(page.locator(".adm-confirm"), "the approval asked first — 1a holds it instead").toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(/письмо уйдёт через \d+ с/);   // it counts down now: 10, 9, … (custHold)
    await expect(page.locator(".adm-toast__undo")).toBeVisible();
    await expect.poll(async () => {
      const res = await page.request.get(`/api/admin/customers/${encodeURIComponent(email)}/`);
      return (await res.json()).customer.tier;
    }, { timeout: 25_000, message: "«Сделать партнёром» never reached the server" }).toBe("pro");
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

/* Renat, 13.09.2026: publishing a review «works but takes time». The panel
   knew everything the change did — the row was in its hands and the counts
   move by one — and threw the whole list away anyway: a skeleton over the
   queue, all three counters to zero, and a re-read of up to a hundred full
   review rows plus a count(*), fired twice in a race. The row moves on the
   list now (app.js admReviewApplyLocal), and the PATCH is the only call. */
test.describe("admin sections — Клиенты: publishing a review costs one call", () => {
  test.use({ extraHTTPHeaders: ipHeaders(186) });

  test("the row leaves «Новые», the counts move, and nothing is re-fetched", async ({ page }) => {
    const name = `E2E fast ${Date.now().toString().slice(-6)}`;
    const filed = await page.request.post("/api/reviews/", {
      data: { product: PRODUCT.id, rating: 5, name, text: "Публикация не должна перерисовывать весь список.", lang: "RU", consent: true },
      headers: ipHeaders(187),
    });
    expect(filed.ok(), "the review could not be filed").toBe(true);

    let reviewId = "";
    try {
      await loginAsAdmin(page);
      await waitForScreen(page, "admin");
      await adminSection(page, "people", "reviews");
      const row = page.locator(".adm-row", { hasText: name }).first();
      await expect(row).toBeVisible();
      const approvedChip = page.locator('[data-admrevfilter="approved"]');
      const before = Number((((await approvedChip.textContent()) || "").match(/(\d+)\s*$/) || [])[1] || 0);

      const calls: string[] = [];
      page.on("request", (req) => {
        if (req.url().includes("/api/admin/reviews")) calls.push(req.method());
      });
      await row.locator("[data-admrev]").first().click();

      // the row is gone from «Новые» — and the queue was never blanked to a
      // skeleton, which is what the re-fetch used to put there
      await expect(page.locator(".adm-row", { hasText: name })).toHaveCount(0);
      await expect(page.locator(".adm-skel")).toHaveCount(0);
      // …the «Опубликованные» count moved by exactly one, without asking
      await expect(approvedChip).toHaveText(new RegExp(`\\b${before + 1}\\s*$`));
      // …and the change really reached the server
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/reviews/?status=approved");
        const hit = ((await res.json()).reviews as Array<{ id: string; name: string }>).find((r) => r.name === name);
        if (hit) reviewId = hit.id;
        return !!hit;
      }, { timeout: 10_000, message: "«Опубликовать» never reached the server" }).toBe(true);
      expect(calls, "publishing a review should be the PATCH and nothing else").toEqual(["PATCH"]);
    } finally {
      if (reviewId) await page.request.patch("/api/admin/reviews/", { data: { id: reviewId, status: "rejected" } });
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
    /* 1a: the letter saves itself a second after the last keystroke (Dim,
       q6) — no «Сохранить», and no «Применить» behind one (Renat, 13.09.2026) */
    const write = page.waitForResponse(
      (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT" &&
        (r.request().postData() || "").includes("mail_texts"));
    await page.locator('[data-mailtxt="subject"]').fill(subject);
    // the preview beside the fields is live — it shows the letter, not the template
    await expect(page.locator('[data-mailprev="subject"]')).toContainText("R-100042");
    try {
      expect((await write).ok()).toBe(true);
      await expect(page.locator("[data-mailsave]"), "a «Сохранить» is back on a letter that saves itself").toHaveCount(0);
      await expect(page.locator("[data-admapply]")).toHaveCount(0);

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

    // 1a: the line at the foot says where the article stands; «Опубликовать» is the dark button
    await expect(page.locator("[data-blogpubstate]")).not.toContainText("Опубликована");
    const slug = await page.locator("[data-blogslug]").inputValue();
    /* Written in Russian only, so «Опубликовать» first asks what the Estonian
       and English readers will get — on the confirm sheet; its own test is in
       admin-blog.spec.ts. */
    await page.locator("[data-admblogpublish]").click();
    await page.locator(".adm-confirm [data-admapply]").click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("[data-blogpubstate]")).toContainText("Опубликована — правки видны сразу");

    const api = await page.request.get(`/api/blog/${slug}/?lang=RU`);
    expect(api.status(), "the published post is not on the public API").toBe(200);

    // …and the list shows it with its tag
    await page.locator("[data-admblogback]").click();
    const row = page.locator(".adm-brow", { hasText: title }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Опубликована");

    // leave the blog as it was found — «Снять с публикации» is in «⋯» (1a)
    await row.click();
    await page.locator("[data-admblogmenu]").click();
    await page.locator("[data-admblogunpublish]").click();
    await expect(page.getByRole("status")).toBeVisible();
  });
});

test.describe("admin sections — Настройки", () => {
  test.use({ extraHTTPHeaders: ipHeaders(184) });

  test("a tariff saves itself when its box is left and is taken back from the journal", async ({ page }) => {
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

      /* 1a (25.09.2026, README § 2): a price saves when its box is left — no
         «Сохранить», no confirm card; «Вернуть» on the toast and in the
         journal is the way back. The toast only after the server's 2xx. */
      const put = page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
      await courierEE.press("Tab");
      expect((await put).ok()).toBe(true);
      await expect(page.locator(".adm-confirm"), "a price above the tariff asked a question").toHaveCount(0);
      await expect(page.getByRole("status")).toContainText("Тарифы доставки сохранены", { timeout: 15_000 });

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
 * Since 1a (25.09.2026, README § 2) each one saves itself — a text a second
 * after the last keystroke, a number when its box is left — with no confirm
 * card, and lands on the server; the report is a link, and the link is the
 * one the API serves.
 */
test.describe("admin sections — Настройки: the rebuilt cards", () => {
  test.use({ extraHTTPHeaders: ipHeaders(185) });

  test("banner, shop details and prices save themselves; the report link points at the export", async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(testProjectIsMobile(test.info()), "one write per action is enough — desktop runs it");
    await loginAsAdmin(page);
    const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings;
    const before = await stored();

    /* ---- Главная страница: the banner ------------------------------------ */
    const title = `E2E баннер ${Date.now().toString().slice(-6)}`;
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="home"]').click();
      // a slide is a row with its own switch, order buttons, and its title opens it
      await expect(page.locator('[data-heroon="0"]')).toHaveAttribute("aria-checked", "true");
      await page.locator('[data-heroedit="0"]').click();
      await page.locator('[data-herof="title"]').fill(title);
      // a long text saves a second after the last keystroke, no card asks
      await expect(page.getByRole("status")).toContainText("Баннер сохранён", { timeout: 10_000 });
      await expect(page.locator(".adm-confirm")).toHaveCount(0);
      await expect.poll(async () => (await stored()).hero?.slides?.[0]?.title?.RU,
        { timeout: 20_000, message: "the title never reached settings.hero" }).toBe(title);
      await page.locator("[data-heroclose]").first().click();
    } finally {
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }

    /* ---- О компании: the shop's own details ----------------------------- */
    try {
      await page.reload();
      await waitForScreen(page, "admin");
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="company"]').click();
      await openFold(page, "content:company");
      const phone = page.locator('[data-contentf="company.phone"]');
      await phone.fill("+372 5000001");
      await phone.press("Tab");
      await expect(page.getByRole("status")).toContainText("Данные магазина сохранены", { timeout: 15_000 });
      await expect.poll(async () => (await stored()).content?.company?.phone,
        { timeout: 20_000, message: "the phone never reached settings.content" }).toBe("+372 5000001");
    } finally {
      // back to the standard details through the panel's own reset, under «⋯»
      await adminSection(page, "setup");
      const back = page.locator("[data-admsetback]");
      if (await back.count()) await back.first().click();
      await page.locator('[data-admsetpage="company"]').click();
      await openMore(page, "company");
      await page.locator('[data-contentreset="company"]').click();
      await expect.poll(async () => (await stored()).content?.company?.phone ?? "").not.toBe("+372 5000001");
    }

    /* ---- Цены и баллы ---------------------------------------------------- */
    const originalPricing = JSON.parse(JSON.stringify(before.pricing || {}));
    try {
      // the nav item always lands on the index of the six pages
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="prices"]').click();
      const pct = page.locator('[data-pricingf="proDiscountPct"]');
      await pct.fill("22");
      await pct.press("Tab");
      await expect(page.getByRole("status")).toContainText("Цены и баллы сохранены", { timeout: 15_000 });
      await expect(page.locator(".adm-confirm"), "q40: the prices ask no question").toHaveCount(0);
      await expect.poll(async () => (await stored()).pricing?.proDiscountPct,
        { timeout: 20_000, message: "the discount never reached settings.pricing" }).toBe(22);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { pricing: originalPricing } });
    }

    /* ---- Отчёт для бухгалтера: the download link ------------------------- */
    await page.reload();
    await waitForScreen(page, "admin");
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="company"]').click();
    const month = await page.locator("[data-admreportsmonth]").inputValue();
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    /* the card's own tiles read the same route as JSON when the page opens —
       that request is not the button's */
    const opened = page.context().waitForEvent("request",
      (r) => r.url().includes("/api/admin/reports/orders/") && !r.url().includes("format=json"));
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

    // the lead answers the question, and links to where the discount lives — behind «?» since 1a
    await page.locator('[data-admhelp="people"]').click();
    const lead = page.locator(".adm-page .adm-helpp .adm-lead");
    await expect(lead).toContainText("Заявка на партнёрство");
    await expect(lead.locator('[data-admgoset="prices"]')).toBeVisible();

    /* ---- «+ Партнёр»: the form, the POST ten seconds later (1a, q3) ------- */
    const email = freshEmail("sections-partner");
    await page.locator("[data-admpartnernew]").click();
    await page.locator('[data-partnerf="email"]').fill(email);
    await page.locator('[data-partnerf="company"]').fill("Salon E2E OÜ");
    const post = page.waitForResponse(
      (r) => r.url().includes("/api/admin/customers/") && r.request().method() === "POST", { timeout: 25_000 });
    await page.locator("[data-admpartnersave]").click();
    await expect(page.locator(".adm-confirm"), "«+ Партнёр» asked first — 1a holds the letter instead").toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(/Партнёр добавлен · письмо уйдёт через \d+ с/);   // counts down (custHold)
    const answer = await (await post).json();
    expect(answer.ok, "POST /api/admin/customers/ refused the partner").toBe(true);
    expect(answer.created).toBe(true);
    expect(answer.promoted).toBe(true);
    await expect(page.getByRole("status")).toContainText("Партнёр добавлен");
    // reversible — «Отменить» on the toast (README § State)
    await expect(page.locator(".adm-toast__undo")).toBeVisible();

    try {
      // the list is back on «Все» (gap B8), and the new row is there, tagged «Партнёр»
      await expect(page.locator('[data-admcusttier=""]')).toHaveAttribute("aria-current", "true");
      const row = page.locator(".adm-row", { hasText: email }).first();
      await expect(row, "the new partner is not in the list").toBeVisible();
      await expect(row.locator(".adm-crow__tags .adm-tag").first()).toHaveText("Партнёр");
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

        /* …and the status taken away again reaches that OPEN page. Until
           13.09.2026 the partner prices were fetched once and never dropped,
           so a demoted partner went on being shown salon prices — prices the
           order would not be billed at — until they reloaded (Renat). The
           shop re-asks who they are when it comes back to the front
           (acctRefresh in app.js), and a profile that is no longer 'pro'
           clears S.pro. No reload here, on purpose: that is the bug. */
        await page.request.patch(`/api/admin/customers/${encodeURIComponent(email)}/`, { data: { tier: "retail" } });
        // past acctRefresh's three-second guard, then the shop comes back to the front
        await shopper.waitForTimeout(3_200);
        await shopper.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect(shopper.locator(".pdp .chip", { hasText: "Цена для салонов" }),
          "the salon price survived the partner status being taken away").toHaveCount(0);
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

  /* Since 1a every box here saves itself when it is left (q40), so the test
     puts the shop's pricing back as it found it — it would otherwise leak a
     25 % salon discount into the specs that run after it. */
  test("«Цены и баллы» works the example out in euros while the owner types", async ({ page }) => {
    await loginAsAdmin(page);
    const was = (await (await page.request.get("/api/admin/settings/")).json()).settings.pricing ?? {};
    try {
      await pricingExample(page);
    } finally {
      await settled(page);
      await page.request.put("/api/admin/settings/", { data: { pricing: was } });
    }
  });

  async function pricingExample(page: Page): Promise<void> {
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
  }

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

/**
 * 1a (25.09.2026, README § 2 and ADM_SAVE_POLICY in app.js) took r12's save
 * bar away from «Настройки»: every page saves itself — a long text a second
 * after the last keystroke, a number when its box is left or on Enter, a
 * switch at once — and the way back is «Вернуть», on the toast and in the
 * journal. The toast (and «Сохранено ✓» in the header) only after the
 * server's 2xx. Both viewports: the phone is where the bar used to be.
 */
test.describe("admin sections — Настройки: pages that save themselves", () => {
  test.use({ extraHTTPHeaders: ipHeaders(219) });

  test("no «Сохранить» on «Главная страница»; a slide's title saves itself and «Вернуть» takes it back", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings;
    const before = await stored();
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="home"]').click();
      await expect(page.locator("[data-setbar]"), "the page still draws a save bar").toHaveCount(0);
      expect(await page.locator(".adm-page").getByRole("button", { name: "Сохранить", exact: true }).count(),
        "a card kept a «Сохранить» of its own").toBe(0);

      await page.locator('[data-heroedit="0"]').click();
      const title = page.locator('[data-herof="title"]');
      const was = await title.inputValue();
      await title.fill("E2E — сохраняется само");
      const toast = page.getByRole("status");
      await expect(toast).toContainText("Баннер сохранён", { timeout: 10_000 });
      await expect.poll(async () => (await stored()).hero?.slides?.[0]?.title?.RU).toBe("E2E — сохраняется само");

      // «Вернуть» on that toast: the banner as it was, on the server too
      await page.locator(".adm-toast__undo").click();
      await expect.poll(async () => (await stored()).hero?.slides?.[0]?.title?.RU ?? "",
        { timeout: 20_000, message: "«Вернуть» did not take the title back" }).not.toBe("E2E — сохраняется само");
      if (!(await page.locator("#heroform").count())) await page.locator('[data-heroedit="0"]').click();
      await expect(page.locator('[data-herof="title"]')).toHaveValue(was);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }
  });

  test("«О компании»: Enter saves the invoice term, the toast follows the server's answer", async ({ page }, testInfo) => {
    test.skip(testProjectIsMobile(testInfo), "one write per action is enough — desktop runs it");
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const before = await (await page.request.get("/api/admin/settings/")).json();
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="company"]').click();
      await openFold(page, "content:invoice");
      await expect(page.locator("[data-adminvsave]"), "the invoice card kept its «Сохранить»").toHaveCount(0);
      const due = page.locator('[data-invsetf="dueDays"]');
      const was = await due.inputValue();
      await due.fill(String(Number(was) + 2));
      const put = page.waitForResponse((r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
      await due.press("Enter");
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toContainText("Счета для компаний: сохранено ✓", { timeout: 15_000 });
      await expect(page.locator(".adm-toast__undo"), "the saved term has no way back").toBeVisible();
      const saved = await (await page.request.get("/api/admin/settings/")).json();
      expect(saved.settings.invoice.dueDays).toBe(Number(was) + 2);

      /* A value the server would refuse is not sent at all: the box turns
         rust with one line under it, and nothing leaves (README § 2). */
      let sent = 0;
      page.on("request", (r) => { if (r.url().includes("/api/admin/settings/") && r.method() === "PUT") sent++; });
      await due.fill("500");
      await due.press("Enter");
      await expect(due).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator('[data-ashint]:visible').first()).not.toBeEmpty();
      await page.waitForTimeout(800);
      expect(sent, "an out-of-range term was sent").toBe(0);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { invoice: before.settings.invoice ?? null } });
    }
  });
});

/**
 * Defects 10 and 11 of Dim's list (10.09.2026), both on «Настройки → Главная».
 * 10: picking a new picture for an existing slide threw the page — measured
 * 869 px on a desktop and 1433 px on a phone before the fix (app.js
 * paintHeroPick says why). 11: with five slides «Добавить слайд» went grey
 * and nothing said why.
 */
test.describe("admin sections — the banner editor keeps its place", () => {
  test.use({ extraHTTPHeaders: ipHeaders(220) });

  test("picking a picture keeps the page where it is, and the tile keeps its focus", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings;
    const before = await stored();
    try {
      await pickTwice(page, stored);
    } finally {
      // a pick saves itself since 1a — the banner goes back as it was found
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }
  });

  async function pickTwice(page: Page, stored: () => Promise<{ hero?: { slides?: Array<{ image?: string }> } }>): Promise<void> {
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    await page.locator('[data-heroedit="0"]').click();
    const list = page.locator("#heroimglist");
    await list.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(300);
    const y = () => page.evaluate(() => window.scrollY);
    const saved = await list.locator('[data-heroimg][aria-current="true"]').first().getAttribute("data-heroimg");
    const other = await list.locator(`[data-heroimg]:not([data-heroimg="${saved}"])`).first().getAttribute("data-heroimg");
    // away from the saved picture, then back to it — the second pick is the
    // one that used to throw the page (the draft equals the saved banner again)
    for (const id of [other, saved]) {
      const before = await y();
      await list.locator(`[data-heroimg="${id}"]`).click();
      await expect(list.locator(`[data-heroimg="${id}"]`)).toHaveAttribute("aria-current", "true");
      await page.waitForTimeout(300);
      expect(Math.abs((await y()) - before), `picking ${id} moved the page`).toBeLessThan(4);
      expect(await page.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute("data-heroimg")),
        `picking ${id} lost the focus`).toBe(true);
    }
    // back where it started — and saved so, each pick on its own (1a)
    await expect.poll(async () => (await stored()).hero?.slides?.[0]?.image).toBe(saved);
  }

  test("the sixth slide is refused out loud, next to the button", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const before = (await (await page.request.get("/api/admin/settings/")).json()).settings;
    try {
      await sixthSlide(page);
    } finally {
      // «+ Слайд» and «Удалить слайд» save themselves since 1a
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }
  });

  async function sixthSlide(page: Page): Promise<void> {
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    const add = page.locator("[data-heroadd]");
    const why = page.locator("[data-heromax]");
    const rows = page.locator("[data-heroedit]");
    /* The standard banner IS five slides — step below the ceiling first.
       «Удалить слайд» is in the open slide's form and asks (q8). */
    if (await add.isDisabled()) {
      await rows.last().click();
      await page.locator("[data-herodel]").click();
      await expect(page.locator(".adm-confirm__t")).toBeVisible();
      await page.locator("[data-admapply]").click();
      await expect(page.getByRole("status")).toContainText("Слайд удалён");
    }
    await expect(add).toBeEnabled();
    await expect(why, "the reason shows below the ceiling").toBeHidden();
    let guard = 0;
    while (!(await add.isDisabled()) && guard++ < 8) {
      await add.click();
      await page.locator("[data-heroclose]").first().click();
    }
    expect(await rows.count(), "more than five slides were accepted").toBe(5);
    await expect(add).toBeDisabled();
    await expect(why).toBeVisible();
    await expect(why).toContainText("Максимум 5 слайдов");
    // beside the button — in its row on a desktop, the line right under it on a phone
    const [b, w] = await Promise.all([add.boundingBox(), why.boundingBox()]);
    expect(b && w, "no boxes to compare").toBeTruthy();
    expect(w!.y, "the reason is nowhere near the button").toBeLessThan(b!.y + b!.height + 24);
  }
});

/**
 * Playwright has no first-class "is this the mobile project" flag, so the
 * projects that draw the panel in its narrow layout are NAMED here.
 *
 * This used to read «not desktop», which quietly called every future project a
 * phone — and one arrived: `webkit-local` is Desktop Safari at 1280 × 720, so
 * the save-bar test demanded a bottom nav of a browser that correctly draws the
 * laptop header, and read the top bar's `top: 0` as the phone nav's top edge.
 * An allowlist fails the safe way round: a project nobody listed is treated as
 * a desktop, which is what an unnamed project most likely is.
 */
function testProjectIsMobile(info: { project: { name: string } }): boolean {
  return info.project.name === "tablet"
    || info.project.name === "mobile"
    || info.project.name === "mobile-safari";
}
