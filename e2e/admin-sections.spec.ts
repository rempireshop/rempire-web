import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

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

/**
 * Opens a section by the old key it has always had, then its sub-tab if the
 * screen has one. All six of these live in the desktop sidebar but behind the
 * phone's «Ещё» sheet, so on a 375-px viewport the nav item simply is not on
 * screen until the sheet is open — which is the one navigation difference
 * between the two viewports this file has to know about.
 */
async function section(page: Page, key: string, sub?: string): Promise<void> {
  const direct = page.locator(`[data-admtab="${key}"][aria-current]:visible`);
  const more = page.locator("[data-admmore]:visible");
  /* Wait for whichever navigation this viewport draws before counting: after a
     reload the shell is a frame or two behind, and an immediate count of zero
     would send a desktop run looking for the phone's «Ещё» button. */
  await expect(direct.or(more).first()).toBeVisible();
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await more.first().click();
    await page.locator(`.adm-sheet [data-admtab="${key}"]`).first().click();
  }
  if (sub) await page.locator(`[data-admtab="${sub}"][aria-current]:visible`).first().click();
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
      await section(page, key, sub);
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
    await section(page, "setup");
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
    await section(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    /* «Одобрить Pro» sits on the row itself now — the whole point of the
       redesign is that a waiting request is answered without opening a card. */
    const approve = page.locator(`[data-admcustapprove]`).first();
    await expect(approve, "the pending request has no «Одобрить Pro» on its row").toBeVisible();
    await approve.click();
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
      await section(page, "people", "reviews");
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
      await section(page, "setup");
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
    await section(page, "promos");
    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(code);
    await page.locator('[data-promokind="percent"]').click();
    await page.locator('[data-promof="value"]').fill("15");
    await page.locator("[data-admpromosave]").click();
    await expect(page.getByText(code)).toBeVisible();
    const promos = await (await page.request.get("/api/admin/promos/")).json();
    expect((promos.promos as Array<{ code: string }>).some((p) => p.code === code),
      "the new code never reached the server").toBe(true);

    /* ---- Подарочные карты: a denomination the /gift/ page reads ---------- */
    await section(page, "promos", "gift");
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
    await section(page, "promos", "mail");
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
    await section(page, "blog");

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
    await page.locator("[data-admblogpublish]").click();
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
      await section(page, "setup");
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

/** Playwright has no first-class "is this the mobile project" flag. */
function testProjectIsMobile(info: { project: { name: string } }): boolean {
  return info.project.name !== "desktop";
}
