import { expect, test } from "@playwright/test";
import { ipHeaders, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

/**
 * Chatbot widget (public/shop2/chat.js). Desktop only, single run — see
 * docs/testing.md. The suite runs with OPENAI_API_KEY empty (playwright.config
 * .ts) specifically so this spec exercises the real "no key" path.
 *
 * chat.js's own client-side probeAI() (GET /api/assistant/) sets
 * aiEnabled=false before reply() is ever called, so with no key the widget
 * NEVER calls the POST route that would 503 — it falls back to its
 * rule-based catalogue matcher silently, and that fallback bubble IS the
 * "graceful disabled state": no error, no broken UI, just an answer that
 * did not come from the model. See src/app/api/assistant/route.ts and
 * docs/testing.md for the server-side half of this (and why the literal
 * 401-for-admin-mode security check lives in a vitest unit test instead of
 * here — the two facts are the same root cause).
 */
test.use({ extraHTTPHeaders: ipHeaders(100) });

test.describe("the assistant on a desktop", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "chatbot spec — desktop project only, see docs/testing.md");
  });

test("FAB opens the panel, close works, and a message gets a graceful reply with no key", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");

  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute("aria-expanded", "false");

  await fab.click();
  await expect(fab).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await expect(panel).toBeVisible();

  const log = panel.locator("[data-log]");
  const before = await log.locator(".sbot__msg").count();

  await panel.locator("[data-in]").fill("борода");
  await panel.getByRole("button", { name: "Отправить" }).click();

  // "me" bubble + a "bot" reply — never a 503, never a visible error, always
  // *something* back (rulesReply() always returns a bubble, matched or not).
  await expect(async () => {
    expect(await log.locator(".sbot__msg").count()).toBeGreaterThanOrEqual(before + 2);
  }).toPass({ timeout: 5_000 });
  await expect(log.locator(".sbot__msg--bot").last()).toBeVisible();
  await expect(page.locator(".sbot__msg--bot", { hasText: /error|ошибка|503|unavailable/i })).toHaveCount(0);

  // Close via the explicit close button (not just re-clicking the FAB) —
  // scoped to the panel since the cart drawer and toasts also use "Закрыть".
  await panel.getByRole("button", { name: "Закрыть" }).click();
  await expect(fab).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

/* Dim, 07.09.2026: «checkoutis pole assistenti vaja». Nobody at the till is
   still choosing a shampoo, and the widget sat on top of the payment buttons.
   Two halves to the promise: the FAB is gone the moment the checkout screen
   is drawn, and it comes back on the way out — the widget is a single
   long-lived root that hides and shows itself (chat.js refreshVisibility), so
   "gone" must not mean "gone for the rest of the visit". */
test("no assistant on the checkout screen, and it returns on the way out", async ({ page }) => {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();

  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();

  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await expect(fab).toBeHidden();

  // …and back on the catalogue it is there again
  await page.goto(shopUrl("", "/c/all/"));
  await waitForScreen(page, "catalog");
  await expect(fab).toBeVisible();
});

/* A desktop window dragged down to phone width is the same shopper on the
   same page — the assistant has to leave with the width, not wait for a
   reload. matchMedia drives both the mount in app.js and the hide here. */
test("a window narrowed to phone width takes the assistant with it", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await expect(fab).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(fab).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(fab).toBeVisible();
});

/* Dim, 10.09.2026: half a minute into a catalogue page a small bubble beside
   the button says «Подобрать уход? Спросите ассистента» — once a session,
   never once the chat has been opened, never off the catalogue side, and a ×
   (or Escape) keeps it away for a week. All of that is NUDGE_* at the top of
   chat.js; NUDGE_MS below mirrors NUDGE_DELAY_MS. The clock is Playwright's:
   the thirty seconds (and the seven days) are jumped, not waited. */
const NUDGE_MS = 30_000;
const NUDGE_TEXT = "Подобрать уход? Спросите ассистента";

test("half a minute on the catalogue brings one reminder bubble — polite, once a session, catalogue only", async ({ page }) => {
  await page.clock.install();
  await page.goto(shopUrl("", "/c/all/"));
  await waitForScreen(page, "catalog");
  const nudge = page.locator("[data-nudge]");
  // a live region from the first paint, empty — that is how the announcement
  // happens later without a focus change and without the toast's role
  await expect(nudge).toHaveAttribute("aria-live", "polite");
  await expect(nudge).not.toHaveAttribute("role");
  await expect(nudge).toBeEmpty();

  await page.clock.fastForward(NUDGE_MS + 500);
  const text = nudge.getByRole("button", { name: NUDGE_TEXT });
  await expect(text).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest(".sbot__nudge")),
    "the bubble took the focus").toBe(false);
  // it comes in with a small rise — unless the shopper asked for less motion
  expect(await nudge.evaluate((el) => getComputedStyle(el).animationName)).toBe("sbotNudge");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await nudge.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // the account is not the catalogue: walking there takes the bubble away
  await page.locator('[data-go="account"]:visible').first().click();
  await waitForScreen(page, "account");
  await expect(nudge).toBeEmpty();

  // …and it was the one for this session: another catalogue page, another
  // half minute, nothing
  await page.goto(shopUrl("", "/c/hair/"));
  await waitForScreen(page, "catalog");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge).toBeEmpty();
});

test("Escape or × keep the bubble away for a week, then it may come back; its text opens the chat", async ({ page }) => {
  await page.clock.install();
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  const nudge = page.locator("[data-nudge]");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge.getByRole("button", { name: "Закрыть подсказку" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(nudge).toBeEmpty();
  expect(await page.evaluate(() => Number(localStorage.getItem("rempire-nudge-off") || 0)),
    "the dismissal was not remembered").toBeGreaterThan(0);

  // a new session two days on: still nothing
  await page.evaluate(() => sessionStorage.clear());
  await page.clock.fastForward(2 * 864e5);
  await page.reload();
  await waitForScreen(page, "product");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge).toBeEmpty();

  // eight days on it is allowed again — and this time its text is the way in
  await page.evaluate(() => sessionStorage.clear());
  await page.clock.fastForward(6 * 864e5);
  await page.reload();
  await waitForScreen(page, "product");
  await page.clock.fastForward(NUDGE_MS + 500);
  const text = nudge.getByRole("button", { name: NUDGE_TEXT });
  await expect(text).toBeVisible();
  await text.click();
  await expect(nudge).toBeEmpty();
  await expect(page.getByRole("region", { name: "Чат с помощником" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Чат с помощником" })).toHaveAttribute("aria-expanded", "true");

  // the × proper, in a fresh session
  await page.getByRole("region", { name: "Чат с помощником" }).getByRole("button", { name: "Закрыть" }).click();
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem("rempire-nudge-off"); });
  await page.reload();
  await waitForScreen(page, "product");
  await page.clock.fastForward(NUDGE_MS + 500);
  await nudge.getByRole("button", { name: "Закрыть подсказку" }).click();
  await expect(nudge).toBeEmpty();
  expect(await page.evaluate(() => Number(localStorage.getItem("rempire-nudge-off") || 0))).toBeGreaterThan(0);
});

test("no bubble on the account or a legal page, and none once the chat itself was opened", async ({ page }) => {
  await page.clock.install();
  const nudge = page.locator("[data-nudge]");

  await page.goto(shopUrl("", "/account/"));
  await waitForScreen(page, "account");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge).toBeEmpty();

  await page.goto(shopUrl("", "/info/shipping/"));
  await waitForScreen(page, "info");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge).toBeEmpty();

  // a shopper who found the chat on his own needs no reminder
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  const fab = page.getByRole("button", { name: "Чат с помощником" });
  await fab.click();
  await page.getByRole("region", { name: "Чат с помощником" }).getByRole("button", { name: "Закрыть" }).click();
  await expect(fab).toHaveAttribute("aria-expanded", "false");
  await page.clock.fastForward(NUDGE_MS + 500);
  await expect(nudge).toBeEmpty();
});

/* Dim, 10.09.2026: «Развернуть» in the panel's header — a ~720-px, 80-vh
   window instead of the 360-px column, remembered for the session (chat.js
   setWide, sessionStorage). A phone is not in this picture: chat.js never
   loads there (the phone test below). */
test("«Развернуть» makes the panel a wide window, and the session remembers it", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await expect(panel).toBeVisible();
  expect(Math.round((await panel.boundingBox())!.width)).toBe(360);

  const toggle = panel.getByRole("button", { name: "Развернуть" });
  await expect(toggle).toBeVisible();
  expect((await toggle.boundingBox())!.height, "the toggle is too small to hit").toBeGreaterThanOrEqual(32);
  await toggle.click();
  await expect(panel.getByRole("button", { name: "Свернуть" })).toBeVisible();
  const wide = (await panel.boundingBox())!;
  expect(Math.round(wide.width)).toBe(720);
  expect(Math.round(wide.height)).toBe(Math.round(page.viewportSize()!.height * 0.8));
  expect(await page.evaluate(() => sessionStorage.getItem("rempire-chat-wide"))).toBe("1");

  // the same session, a reload later: it opens wide
  await page.reload();
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  await expect(panel.getByRole("button", { name: "Свернуть" })).toBeVisible();
  expect(Math.round((await panel.boundingBox())!.width)).toBe(720);

  await panel.getByRole("button", { name: "Свернуть" }).click();
  await expect(panel.getByRole("button", { name: "Развернуть" })).toBeVisible();
  expect(Math.round((await panel.boundingBox())!.width)).toBe(360);
});

/* r21. The shop prompt asks the assistant to end an answer with the article's
   own address — «add its link at the end of your reply as a bare relative
   path: /blogs/news/<slug>» (src/app/api/assistant/route.ts) — and the bubble
   printed it as text a shopper could only retype into the address bar.

   The model is stubbed here, both halves of it: this suite runs with no key on
   purpose (see the file header), so the widget's own probe answers «no model»
   and the POST below is never made otherwise. It is the one path in this file
   that needs the model to be there. */
test("the article the assistant points at is a link, and it opens the article", async ({ page }) => {
  const SLUG = "uhod-za-borodoy-zimoy";
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ enabled: true, v: 99, model: "stub" }),
      });
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        reply: `Зимой борода сохнет — вот статья про это: /blogs/news/${SLUG}`,
        product_ids: [],
      }),
    });
  });

  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("что делать с сухой бородой зимой");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const link = panel.locator(`.sbot__msg--bot a[data-go-blog="${SLUG}"]`);
  await expect(link).toBeVisible();
  // in the language the shopper is reading — this page is /ru
  await expect(link).toHaveAttribute("href", `/ru/blogs/news/${SLUG}`);

  // …and it is the shop's own link: the article opens in place, no reload
  await link.click();
  await waitForScreen(page, "blogpost");
  expect(new URL(page.url()).pathname).toBe(`/ru/blogs/news/${SLUG}`);
});

/* 02.11.2026, Dim: «blogs become the source of truth for product choice». An
   answer built on one of the salon's articles carries the article as data
   (src/app/api/assistant/blog-digest.ts articleOfAnswer) and the widget draws
   it as the design does (canvas-banner/project/Assist.dc.html): the sentence,
   the article card — cover, «Из нашего блога», title — then the products,
   then «Добавить всё в корзину». The model is stubbed, as above. */
test("an answer from a salon article shows the article card above its products, «Добавить всё» under them", async ({ page }) => {
  const SLUG = "uhod-za-borodoy-zimoy";
  const COVER = "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp";
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        reply: "В нашем гайде про бороду зимой — масло каждый день и бальзам, если борода длиннее сантиметра.",
        product_ids: [PRODUCT.id, PRODUCT_2.id],
        article: { slug: SLUG, title: "Борода зимой: как не дать ей пересохнуть", cover: COVER },
      }),
    });
  });

  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("борода зимой сохнет");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const answer = panel.locator(".sbot__msg--bot").filter({ has: page.locator(".sbot__art") });
  await expect(answer).toHaveCount(1);
  const card = answer.locator("a.sbot__art");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", `/ru/blogs/news/${SLUG}`);
  await expect(card.locator(".sbot__art-eb")).toHaveText("Из нашего блога");
  await expect(card.locator(".sbot__art-t")).toHaveText("Борода зимой: как не дать ей пересохнуть");
  await expect(card.locator("img.sbot__art-ph")).toHaveAttribute("src", COVER);
  // the cover is the design's 64-px square
  const box = await card.locator("img.sbot__art-ph").boundingBox();
  expect(Math.round(box!.width)).toBe(64);
  expect(Math.round(box!.height)).toBe(64);

  // the order of the design: card, then the two product rows, then «Добавить всё»
  const order = await answer.evaluate((el) =>
    Array.from(el.querySelectorAll(".sbot__art, .sbot__prod, .sbot__all")).map((n) => n.className.split(" ").pop()),
  );
  expect(order).toEqual(["sbot__art", "sbot__prod", "sbot__prod", "sbot__all"]);
  const addAll = answer.getByRole("button", { name: "Добавить всё в корзину" });
  await expect(addAll).toHaveAttribute("data-addall", `${PRODUCT.id},${PRODUCT_2.id}`);
  await addAll.click();
  await expect(page.locator("[data-cartbadge]").first()).toHaveText("2");

  // the card is the shop's own link: the article opens in place
  await card.click();
  await waitForScreen(page, "blogpost");
  expect(new URL(page.url()).pathname).toBe(`/ru/blogs/news/${SLUG}`);
});

/* Dim, 07.11.2026: a shopper who asks for a set is offered the shop's own
   sets, and an answer with products carries a fitting set under them. With no
   key (this suite) the rules answer: «набор для бороды» lists ready-made sets
   from window.rempireSets() (app.js) — the same list the Sets page draws —
   each row with the shop's own [data-addbundle] / [data-go-bundle]. */
test("offline: «набор для бороды» answers with the shop's sets; «Открыть» opens the set, «В корзину» adds it", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("набор для бороды");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const answer = panel.locator(".sbot__msg--bot").filter({ has: page.locator(".sbot__prod--set") });
  await expect(answer).toHaveCount(1);
  await expect(answer).toContainText("Готовые наборы — вместе дешевле:");
  const rows = answer.locator(".sbot__prod--set");
  expect(await rows.count()).toBeGreaterThanOrEqual(1);
  // every row is a set the shop has, never loose products dressed up as one
  const ids = await rows.locator("[data-go-bundle]").evaluateAll((els) => els.map((e) => e.getAttribute("data-go-bundle")));
  const shelf = await page.evaluate(() => (window as unknown as { rempireSets: () => Array<{ id: string; cat: string }> }).rempireSets());
  for (const id of ids) expect(shelf.map((s) => s.id)).toContain(id);
  expect(shelf.find((s) => s.id === ids[0])?.cat).toBe("beard");
  await expect(rows.first().locator(".sbot__eb")).toHaveText("Набор");
  await expect(answer.locator(".sbot__prod:not(.sbot__prod--set)")).toHaveCount(0);

  await rows.first().getByRole("button", { name: "В корзину" }).click();
  await expect(page.locator("[data-cartbadge]").first()).not.toHaveText(/^0?$/);

  await rows.first().getByRole("button", { name: "Открыть" }).click();
  await waitForScreen(page, "bundle");
});

test("offline: a product answer carries a fitting set under the products", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("масло для бороды");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const answer = panel.locator(".sbot__msg--bot").filter({ has: page.locator(".sbot__prod") }).last();
  await expect(answer.locator(".sbot__prod:not(.sbot__prod--set)").first()).toBeVisible();
  const sets = answer.locator(".sbot__prod--set");
  expect(await sets.count()).toBeGreaterThanOrEqual(1);
  expect(await sets.count()).toBeLessThanOrEqual(2);
  // the sets come after the products
  const kinds = await answer.evaluate((el) =>
    Array.from(el.querySelectorAll(".sbot__prod")).map((n) => (n.classList.contains("sbot__prod--set") ? "set" : "prod")),
  );
  expect(kinds.indexOf("set")).toBeGreaterThan(kinds.lastIndexOf("prod"));
});

/* «уход после татуировки» scored every Yumain product 1 before 07.11.2026 —
   the names say «Tattoo», the question «татуировки» — and the chat said the
   shop had nothing. TOPIC_KW (chat.js, catalogue-slice.ts) maps the word. */
test("offline: a tattoo question finds the Yumain tattoo care", async ({ page }) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("Нужен уход после татуировки");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const answer = panel.locator(".sbot__msg--bot").filter({ has: page.locator(".sbot__prod") }).last();
  // evaluateAll does not wait: the reply has to be on screen first
  await expect(answer.locator("[data-go-product]").first()).toBeVisible();
  const ids = await answer.locator("[data-go-product]").evaluateAll((els) => els.map((e) => e.getAttribute("data-go-product")));
  // the first rows are the tattoo care, not «бальзам после бритья» (which only shares «после»)
  expect(ids[0]).toMatch(/^yumain-.*tattoo/);
  expect(ids.filter((id) => /^yumain-/.test(String(id))).length).toBeGreaterThanOrEqual(2);
});

/* The AI path: the route names the sets in bundle_ids (fittingSets(),
   src/app/api/assistant/shop-sets.ts) and the widget draws each from the
   shop's own list, under the products. An id the shop does not have is left
   out — the list on screen is the authority, not the answer. */
test("an answer with bundle_ids draws the shop's set under the products; an unknown id draws nothing", async ({ page }) => {
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        reply: "Масло и бальзам — а вместе они дешевле в наборе.",
        product_ids: [PRODUCT.id, PRODUCT_2.id],
        bundle_ids: ["beard-start", "no-such-set"],
      }),
    });
  });

  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.getByRole("button", { name: "Чат с помощником" }).click();
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await panel.locator("[data-in]").fill("что для бороды");
  await panel.getByRole("button", { name: "Отправить" }).click();

  const answer = panel.locator(".sbot__msg--bot").filter({ has: page.locator(".sbot__prod--set") });
  await expect(answer).toHaveCount(1);
  const kinds = await answer.evaluate((el) =>
    Array.from(el.querySelectorAll(".sbot__prod")).map((n) => (n.classList.contains("sbot__prod--set") ? "set" : "prod")),
  );
  expect(kinds).toEqual(["prod", "prod", "set"]);
  const set = answer.locator(".sbot__prod--set");
  await expect(set.locator("[data-go-bundle]")).toHaveAttribute("data-go-bundle", "beard-start");
  await expect(set.locator("[data-addbundle]")).toHaveAttribute("data-addbundle", "beard-start");
  await expect(set).toContainText("Борода — стартовый набор");
  await expect(answer.locator('[data-go-bundle="no-such-set"]')).toHaveCount(0);
});

/* window.openChatAbout(slug, title) — the door the blog article page's
   «Спросить об этой статье» opens the chat through (chat.js). It pins the
   article: the chat opens with it on top, and every question then carries
   `article` to the route, which always reads that article first. */
test("openChatAbout opens the chat about one article and sends it with every question", async ({ page }) => {
  const SLUG = "uhod-za-borodoy-zimoy";
  const asked: Array<Record<string, unknown>> = [];
  await page.route("**/api/assistant/**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
    }
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "По статье — масло каждый день.", product_ids: [] }) });
  });

  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  // a slug that is not one is refused, and nothing opens
  expect(await page.evaluate(() => (window as unknown as { openChatAbout: (s: string, t?: string) => boolean }).openChatAbout("../admin"))).toBe(false);
  await expect(page.getByRole("region", { name: "Чат с помощником" })).toBeHidden();

  expect(await page.evaluate((s) => (window as unknown as { openChatAbout: (s: string, t?: string) => boolean }).openChatAbout(s, "Борода зимой"), SLUG)).toBe(true);
  const panel = page.getByRole("region", { name: "Чат с помощником" });
  await expect(panel).toBeVisible();
  const pin = panel.locator(".sbot__msg--bot div.sbot__art");
  await expect(pin.locator(".sbot__art-t")).toHaveText("Борода зимой");
  await expect(panel.locator(".sbot__art-ask")).toHaveText("Спросите об этой статье — например, что из неё подойдёт вам.");

  await panel.locator("[data-in]").fill("а что из этого мне взять?");
  await panel.getByRole("button", { name: "Отправить" }).click();
  await expect(panel.locator(".sbot__msg--bot", { hasText: "По статье — масло каждый день." })).toBeVisible();
  await panel.locator("[data-in]").fill("а бальзам?");
  await panel.getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked.map((b) => b.article)).toEqual([SLUG, SLUG]);
});
});

/* «mobiilis ei kasuta üldse poes assistenti» — not hidden with CSS, not
   mounted and hidden: on a phone the file is never fetched at all. chat.js
   builds an index of the whole catalogue the moment it loads, so this is
   bytes and work a phone should not spend on something it will never see.
   app.js (mountChat) is what decides; index.html no longer carries the tag. */
test.describe("the assistant on a phone", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile" && testInfo.project.name !== "mobile-safari",
      "phone projects only — this is the half of the rule a desktop cannot see",
    );
  });

  test("chat.js is never requested and no FAB is drawn, on any shop screen", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/shop2/chat.js")) asked.push(r.url()); });

    const fab = page.getByRole("button", { name: "Чат с помощником" });

    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await expect(fab).toHaveCount(0);

    await page.goto(shopUrl("", "/c/all/"));
    await waitForScreen(page, "catalog");
    await expect(fab).toHaveCount(0);

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect(fab).toHaveCount(0);
    // an in-page navigation, not a reload: the mount is decided per render
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await expect(fab).toHaveCount(0);

    expect(asked, `a phone downloaded the assistant: ${asked.join(", ")}`).toEqual([]);
  });
});
