import { expect, test } from "@playwright/test";
import {
  adminSection, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * «Клиенты» → a customer's card: what he bought, what he wrote, and the way
 * back.
 *
 * Dim, 10.09.2026, two findings on one screen. §6: «the card says the
 * customer made 2 orders and spent X, but shows no orders, no analytics,
 * nothing else» — so GET /api/admin/customers/<id> now carries the orders
 * under that e-mail, four facts drawn from them and the customer's reviews,
 * and the card draws all three (app.js admCustFactsHTML, admCustOrdersHTML,
 * admCustReviewsHTML). §7: on a card, the «Отзывы» sub-tab threw him out to
 * the moderation queue when he expected this customer's reviews — the two
 * sub-tabs are not drawn on a card any more; the card is its own page with
 * «← Все клиенты», and its reviews live on it, with «Опубликовать» right
 * there (the queue's own reversible edit).
 *
 * The one thing this file is strict about beyond the sections: an order
 * opened from the card opens the ordinary order card over it, and both its
 * «← К клиенту» and the browser's Back land on THIS customer again — never
 * on «Заказы» (app.js: the data-admorder handler keeps the tab, admLayers
 * closes the order first).
 *
 * 13.09.2026: the review below is filed from the shopper's OWN signed-in
 * session, because that is now the only thing that puts a review on a card.
 * It used to be matched by the name under it, and two customers who share a
 * display name then read each other's reviews («dim.novare@gmail.com and
 * info@diipsolutions.eu seem to be able to see same reviews»). A review left
 * signed out belongs to nobody and stays in the «Отзывы» queue.
 */
test.describe("admin — the customer card", () => {
  /* One address per project (and per repeat), not one for the file:
     POST /api/reviews/ allows three an hour from one address, and this file
     files one on every run. 226+ is free — nothing else in the suite goes
     above 220 + a few repeats (admin-back.spec.ts). */
  test.use({
    extraHTTPHeaders: async ({}, use, testInfo) => {
      await use(ipHeaders(226 + (testInfo.project.name === "mobile" ? 5 : 0) + testInfo.repeatEachIndex));
    },
  });

  test("orders, facts and reviews are on the card; an order opens over it and Back returns to it", async ({ context, page }) => {
    test.setTimeout(180_000);

    // ---- a paid order under a fresh address — the checkout signs it «E2E Buyer»
    const email = freshEmail("custcard");
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, email, "paid");

    await loginAsAdmin(page);

    // ---- a customer row for that address: a guest checkout leaves none, so
    // the panel's own create-by-e-mail makes one — retail, which sends no letter
    const made = await page.request.post("/api/admin/customers/", { data: { email, tier: "retail" } });
    expect(made.ok(), "POST /api/admin/customers/ refused the retail row").toBe(true);

    /* ---- a review from that customer, signed in as himself --------------
       The session is what ties the review to the card (reviews.email,
       db/migrations/022_reviews_author.sql), so it is filed from the
       shopper's own page, code and all, the way a customer files one. The
       name under it is deliberately NOT the name on the order: what puts it
       on this card is the address, and nothing else. */
    const reviewText = `Отличный шампунь, беру уже не первый раз ${Date.now()}.`;
    const shopper = await context.newPage();
    try {
      await shopper.goto(shopUrl("", "/account/"));
      await waitForScreen(shopper, "account");
      await shopper.locator("[data-email]").fill(email);
      const codeRes = shopper.waitForResponse((r) => r.url().includes("/api/account/code/"));
      await shopper.locator("[data-login]").click();
      const code = (await (await codeRes).json()).code as string;
      expect(code, "the e2e login-code hook did not answer").toMatch(/^\d{6}$/);
      await shopper.locator("[data-acctcode]").fill(code);
      await shopper.locator("[data-logincode]").click();
      await expect(shopper.locator("[data-logout]")).toBeVisible();
      const filed = await shopper.request.post("/api/reviews/", {
        data: { product: PRODUCT.id, rating: 5, name: "Не то имя, что в заказе", text: reviewText, lang: "RU", consent: true },
      });
      expect(filed.ok(), "the review could not be filed").toBe(true);
    } finally {
      await shopper.close();
    }

    let reviewId = "";
    try {
      // ---- the list: the queue's tab is there, one tap away ----------------
      await adminSection(page, "people");
      await expect(page.locator('.adm-cseg [data-admtab="reviews"]'), "the «Отзывы» tab is missing from the list").toBeVisible();
      await page.locator("[data-admcustq]").fill(email);
      await page.locator("[data-admcustopen]").first().click();
      await expect(page.locator("[data-admcustclose]")).toBeVisible();

      // ---- the card is its own page: no sub-tabs on it --------------------
      await expect(page.locator('.adm-cseg [data-admtab="reviews"]'), "the «Отзывы» sub-tab is still on the card").toHaveCount(0);
      await expect(page.locator('.adm-cseg [data-admtab="people"]'), "the «Клиенты» sub-tab is still on the card").toHaveCount(0);

      // ---- the order, with the same chip the orders list draws ------------
      const orderRow = page.locator(`[data-admorder]:has-text("${number}")`).first();
      await expect(orderRow, "the paid order is not on the card").toBeVisible();
      await expect(orderRow.locator(".adm-badge")).toHaveText("Оплачен");

      // ---- the facts: plain rows, no chart --------------------------------
      await expect(page.getByText("Первый заказ")).toBeVisible();
      await expect(page.getByText("Средний чек")).toBeVisible();
      // 1a: the facts are cells under the orders (screen 15), not list rows
      const brands = page.locator(".adm-cfact", { hasText: "Любимые бренды" });
      await expect(brands).toBeVisible();
      await expect(brands).toContainText(PRODUCT.brand);

      // ---- the review, matched by the address that wrote it --------------
      await expect(page.getByText("Отзывы клиента")).toBeVisible();
      const reviewRow = page.locator(".adm-row", { hasText: reviewText }).first();
      await expect(reviewRow, "the review this customer wrote is not on his card").toBeVisible();
      await expect(reviewRow.locator(".adm-badge")).toHaveText("Новый");

      // ---- the order card opens over the customer's; Back returns to that
      // customer, not to «Заказы» -------------------------------------------
      await orderRow.click();
      await expect(page.locator('[data-admorder=""]')).toBeVisible();
      await expect(page.locator('[data-admorder=""]'), "the order card's way back does not name the customer").toContainText("К клиенту");
      await expect(page.locator("[data-admcustclose]")).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('body[data-screen="admin"]'), "Back left the admin altogether").toBeAttached();
      await expect(page.locator('[data-admorder=""]'), "Back did not close the order card").toHaveCount(0);
      await expect(page.locator("[data-admcustclose]"), "Back did not return to the customer card").toBeVisible();
      await expect(page.locator(`[data-admorder]:has-text("${number}")`).first(), "the customer's orders are gone after Back").toBeVisible();
      await expect(page.locator("[data-admorderq]"), "Back landed on the orders list instead of the customer").toHaveCount(0);

      // …and the same through the card's own «← К клиенту»
      await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
      await expect(page.locator('[data-admorder=""]')).toBeVisible();
      await page.locator('[data-admorder=""]').click();
      await expect(page.locator("[data-admcustclose]"), "«← К клиенту» did not return to the customer card").toBeVisible();

      // ---- «Опубликовать» from the card: the queue's own reversible edit,
      // without leaving the card ---------------------------------------------
      const row = page.locator(".adm-row", { hasText: reviewText }).first();
      await row.locator('[data-admcustrev$=":approved"]').click();
      await expect(page.getByRole("status")).toContainText("Отзыв опубликован");
      await expect(page.locator(".adm-toast__undo"), "no «Отменить» on the toast").toBeVisible();
      await expect(page.locator("[data-admcustclose]"), "publishing left the card").toBeVisible();
      await expect(row.locator(".adm-badge")).toHaveText("Опубликован");
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/reviews/?status=approved");
        const hit = ((await res.json()).reviews as Array<{ id: string; text: string }>).find((r) => r.text === reviewText);
        if (hit) reviewId = hit.id;
        return !!hit;
      }, { timeout: 10_000, message: "«Опубликовать» never reached the server" }).toBe(true);

      // ---- Back closes the card; the list and its «Отзывы» tab are back ----
      await page.goBack();
      await expect(page.locator('body[data-screen="admin"]'), "Back left the admin altogether").toBeAttached();
      await expect(page.locator("[data-admcustclose]"), "Back did not close the customer card").toHaveCount(0);
      await expect(page.locator("[data-admcustq]"), "the customers list did not come back").toBeVisible();
      await expect(page.locator('.adm-cseg [data-admtab="reviews"]')).toBeVisible();
    } finally {
      /* A published review on PRODUCT changes what the storefront shows, and
         e2e/product.spec.ts expects that product's reviews block to start
         empty. Whatever happened above, the review is taken down again. */
      if (reviewId) await page.request.patch("/api/admin/reviews/", { data: { id: reviewId, status: "rejected" } });
    }
  });

  /**
   * «Розница ⇄ Партнёр» moves under the finger, not a second later.
   *
   * Renat, 13.09.2026: «marking a customer as партнёр takes one to two
   * seconds before the switch reflects it». It did — confirming the card threw
   * the customer card and the 500-row list away and drew a skeleton until two
   * fresh requests came back. The switch is one field, so it moves at once and
   * the PATCH either confirms it or puts it back with the toast the panel has
   * always shown (app.js: admTierLocal / srvPush's set_tier).
   *
   * Both halves are driven here with the answer deliberately held back, so the
   * "moved already" and the "put back" are each unambiguous.
   *
   * 1a (Dim, 25.09.2026, q3): no confirm card any more. The first flip to
   * «Партнёр» posts the welcome letter, so the PATCH itself waits ten seconds
   * for «Вернуть» — the switch still moves at once; the move back to
   * «Розница» sends no letter and goes straight away.
   */
  test("the partner switch moves at once, and comes back if the server refuses", async ({ page }) => {
    test.setTimeout(120_000);
    const email = freshEmail("custtier");
    await loginAsAdmin(page);
    const made = await page.request.post("/api/admin/customers/", { data: { email, tier: "retail" } });
    expect(made.ok(), "POST /api/admin/customers/ refused the retail row").toBe(true);

    await adminSection(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    await page.locator(".adm-row", { hasText: email }).first().locator("[data-admcustopen]").click();
    const pro = page.locator('[data-admcusttierset="pro"]');
    const retail = page.locator('[data-admcusttierset="retail"]');
    await expect(retail).toHaveAttribute("aria-current", "true");

    /* ---- it moves before the server has answered ------------------------- */
    let release: (() => void) | null = null;
    await page.route(
      (u) => u.pathname.startsWith("/api/admin/customers/") && u.pathname.length > "/api/admin/customers/".length,
      async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await new Promise<void>((done) => { release = done; });
        await route.continue();
      },
    );
    await pro.click();
    await expect(page.locator(".adm-confirm"), "the switch asked first — 1a holds the letter instead").toHaveCount(0);
    // nothing has reached the server; the switch, the tag and the card are already there
    await expect(pro, "the switch waited for the server").toHaveAttribute("aria-current", "true");
    await expect(page.locator(".adm-skel"), "the card blanked instead of moving the switch").toHaveCount(0);
    await expect(page.locator(".adm-chd .adm-tag").first()).toHaveText("Партнёр");
    await expect(page.getByRole("status")).toContainText("письмо уйдёт через 10 с");
    await expect(page.locator(".adm-toast__undo")).toBeVisible();
    // …and the PATCH goes when the ten seconds are up
    await expect.poll(() => !!release, { timeout: 20_000, message: "the held PATCH never left" }).toBe(true);
    release!();
    await expect(pro).toHaveAttribute("aria-current", "true");
    await page.unroute((u) => u.pathname.startsWith("/api/admin/customers/"));
    await expect.poll(async () => {
      const res = await page.request.get(`/api/admin/customers/${encodeURIComponent(email)}/`);
      return (await res.json()).customer.tier;
    }, { timeout: 10_000 }).toBe("pro");

    /* ---- and it comes back when the answer is «нет» ---------------------- */
    await page.route(
      (u) => u.pathname.startsWith("/api/admin/customers/") && u.pathname.length > "/api/admin/customers/".length,
      async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await route.fulfill({ status: 503, json: { ok: false, error: "db_unavailable" } });
      },
    );
    await retail.click();
    await expect(page.getByRole("status")).toContainText("Не получилось изменить статус");
    await expect(pro, "a refused change left the switch on the wrong side").toHaveAttribute("aria-current", "true");
    await page.unroute((u) => u.pathname.startsWith("/api/admin/customers/"));
    // the server never moved either — the row is still a partner
    const row = await (await page.request.get(`/api/admin/customers/${encodeURIComponent(email)}/`)).json();
    expect(row.customer.tier).toBe("pro");
    await page.request.patch(`/api/admin/customers/${encodeURIComponent(email)}/`, { data: { tier: "retail" } });
  });
});

/**
 * A card opens at its own top.
 *
 * Renat, 14.09.2026: «When I open a client, then the client page isn't opened
 * at the top, instead it's initially scrolled somewhere to the middle». It was
 * not scrolled anywhere — the window simply kept the scroll of the row that
 * was tapped, and «Клиенты» on a phone is a long list, so a customer opened
 * from the bottom of it appeared already halfway down his own card. Every
 * other opener in this panel («Заказы», «Каталог», «Письма», «Настройки»,
 * «+ Написать») resets the scroll by hand before its render; this one did not
 * (app.js, the data-admcustopen handler).
 *
 * The list and the card are both stubbed rather than seeded. The list has to
 * be longer than a phone to have anywhere to scroll from, and the card taller
 * than a phone for «at the top» to mean anything — neither is true of whatever
 * the rest of the suite happens to have left in the shared database, and
 * forty customers created for one assertion would be left in it for everyone
 * else. Both invariants are asserted below, so the day a stub stops producing
 * them this fails loudly instead of passing on a page that cannot scroll.
 */
test.describe("admin — a customer's card opens at its top", () => {
  test.use({ extraHTTPHeaders: ipHeaders(240) });

  const CUSTOMERS = Array.from({ length: 40 }, (_, i) => ({
    id: `e2e-top-${i}`,
    email: `e2e-top-${i}@example.com`,
    name: `Клиент номер ${i}`,
    tier: "retail",
    ordersCount: (i % 5) + 1,
    revenue: 1990 + i * 100,
    pointsBalance: 0,
    proRequestedAt: null,
    marketing: i % 2 === 0,
    marketingAt: "2026-09-01T10:00:00.000Z",
    notes: "",
    phone: "+372 5000000",
    company: "",
    regCode: "",
  }));
  // far enough down that the row cannot be reached without scrolling
  const WANTED = CUSTOMERS[34];

  const DETAIL = {
    ok: true,
    customer: WANTED,
    history: [],
    stats: {
      firstOrderAt: "2026-01-14T10:00:00.000Z",
      lastOrderAt: "2026-09-01T10:00:00.000Z",
      avgOrder: 4250,
      topBrands: [{ brand: "Davines", n: 4 }],
    },
    orders: Array.from({ length: 12 }, (_, i) => ({
      id: `e2e-top-order-${i}`,
      number: `R-90${100 + i}`,
      createdAt: "2026-08-20T10:00:00.000Z",
      status: "paid",
      channel: "web",
      itemsCount: 2,
      firstItem: "Davines — шампунь",
      total: 4250,
      invoice: null,
      labeled: false,
    })),
    reviews: Array.from({ length: 6 }, (_, i) => ({
      id: `e2e-top-review-${i}`,
      productId: PRODUCT.id,
      product: `${PRODUCT.brand} — шампунь`,
      rating: 5,
      text: `Отзыв номер ${i}: беру уже не первый раз, всё хорошо.`,
      name: "Клиент",
      createdAt: "2026-08-21T10:00:00.000Z",
      status: "approved",
    })),
  };

  test("a customer's card opens at its top, not where the list was scrolled to", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    // the phone the defect was reported on, whichever project is running
    await page.setViewportSize({ width: 375, height: 812 });

    // the list is one page (?limit=500); the card is /api/admin/customers/<id>/
    await page.route(
      (u) => u.pathname === "/api/admin/customers/",
      (route) => (route.request().method() === "GET"
        ? route.fulfill({ json: { ok: true, customers: CUSTOMERS } })
        : route.fallback()),
    );
    await page.route(
      (u) => u.pathname === `/api/admin/customers/${WANTED.id}/`,
      (route) => (route.request().method() === "GET" ? route.fulfill({ json: DETAIL }) : route.fallback()),
    );

    await adminSection(page, "people");
    const row = page.locator(`[data-admcustopen="${WANTED.id}"]`);
    await expect(row, "the stubbed list never reached the screen").toHaveCount(1);

    // ---- down the list, to the row the owner would have to scroll to -------
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.scrollY);
    expect(before, "«Клиенты» did not scroll — there was nowhere to open a card FROM").toBeGreaterThan(400);

    // clicked from the page, not through Playwright, which scrolls first
    await page.evaluate((id) => {
      (document.querySelector(`[data-admcustopen="${id}"]`) as HTMLElement).click();
    }, WANTED.id);

    // the whole card, not the skeleton: «at the top» is about the finished page
    await expect(page.locator("[data-admcustclose]")).toBeVisible();
    await expect(page.locator(".adm-h2")).toHaveText(WANTED.name);
    await expect(page.locator('[data-admorder="e2e-top-order-0"]')).toBeVisible();
    await page.waitForTimeout(300);

    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(room, "the card is shorter than the phone — «at the top» would be true either way").toBeGreaterThan(400);

    const after = await page.evaluate(() => window.scrollY);
    expect(after, "the card opened where the list was, somewhere down its own middle").toBeLessThanOrEqual(4);
  });
});
