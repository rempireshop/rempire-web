import { expect, type Page, test } from "@playwright/test";
import { adminSection, freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl } from "./fixtures";
import { assertClean, clearToast, toastText, watch } from "./sweep-helpers";

/**
 * «Маркетинг → Рассылка» — the owner's own letter, end to end, desktop and
 * mobile: two subscribers tick the box at the checkout, the owner writes a
 * letter in Russian and Estonian with a product card, saves it, sends
 * himself a test, and sends it — through the confirm card that names the
 * count, the climbing progress, and the read-only «Отправлено» that follows.
 *
 * Reading the letters back: the suite runs with no RESEND_API_KEY, so
 * nothing is really sent; `GET /api/e2e/mail/` is the readout of what
 * sendMail() was asked to send (docs/testing.md, «The test-only doors»), and
 * under the same double gate the newsletter counts a sink delivery as sent
 * (src/lib/newsletters.ts e2eSinkTransport) — which is what lets this test
 * watch a real send finish. The sink records the recipient, the subject
 * and the links in the plain-text part — enough to prove the Estonian
 * reader got the Estonian letter and every letter carried «Отписаться».
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "newsletter — desktop and mobile projects, see docs/testing.md");
});

/** The tick at the checkout: an order with `newsletter: true` records the consent (src/lib/consent.ts). */
async function subscribe(page: Page, email: string, lang: "RU" | "ET"): Promise<void> {
  const res = await page.request.post("/api/orders/", {
    data: {
      lang,
      items: [{ id: PRODUCT.id, variant: null, qty: 1 }],
      customer: { name: "E2E Tellija", email, phone: "+372 5555 5555" },
      shipping: { method: "parcel", country: "EE", carrier: "omniva", pointId: "1", pointName: "Kristiine" },
      discountCode: null,
      newsletter: true,
    },
  });
  expect(res.ok(), `the order for ${email} was refused`).toBe(true);
}

interface Captured { to: string[]; subject: string; template: string; links: string[] }

async function captured(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/e2e/mail/?template=newsletter&to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).mails as Captured[];
}

test.describe("admin — newsletter", () => {
  test.use({ extraHTTPHeaders: ipHeaders(190) });

  test("a letter is written in two languages, tested, sent to the subscribers and read back", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const mobile = testInfo.project.name === "mobile";
    const tag = Date.now().toString().slice(-6);
    const ruReader = freshEmail("news-ru");
    const etReader = freshEmail("news-et");
    await subscribe(page, ruReader, "RU");
    await subscribe(page, etReader, "ET");

    await loginAsAdmin(page);
    await adminSection(page, "promos", "news");
    await expect(page.locator('[data-admtab="news"][aria-current="true"]')).toBeVisible();

    /* ---- the list: the subscriber count, then «+ Письмо» ---------------- */
    const audience = page.locator(".adm-news__aud");
    await expect(audience).toBeVisible();
    await expect(audience.locator(".adm-news__n")).toBeVisible();
    const total = Number(await audience.locator(".adm-news__n").textContent());
    expect(total, "the two readers who just ticked the box are not counted").toBeGreaterThanOrEqual(2);
    await assertClean(page, w, "newsletter list");
    // the four states, as pictures, in this test's own output folder
    // (test-results/…): the list, the editor, the confirm card, the sent letter
    await page.screenshot({ path: testInfo.outputPath("news-list.png"), fullPage: true });

    await page.locator("[data-newsnew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box, "the letter has no visual editor").toBeVisible();

    /* ---- Russian: title, subject, text, a product ---------------------- */
    await page.locator('[data-newsf="title"]').fill(`E2E рассылка ${tag}`);
    await page.locator('[data-newsf="subject"]').fill(`E2E тема ${tag}`);
    await box.click();
    await page.keyboard.type("Привет! Это тестовая рассылка магазина.");
    await page.locator("[data-newsq]").fill(PRODUCT.id);
    await page.locator(`[data-newsproductadd="${PRODUCT.id}"]`).click();
    await expect(page.locator(`[data-newsproductdel="${PRODUCT.id}"]`), "the picked product is not listed").toBeVisible();
    await expect(page.locator("[data-newsdirty]")).toBeVisible();

    await page.locator("[data-newssave]").click();
    expect(await toastText(page)).toContain("Черновик сохранён");
    await clearToast(page);
    await expect(page.locator("[data-newsdirty]")).toBeHidden();
    // the preview is the letter itself, product card and all — the iframe is
    // lazy and below the fold, so it is brought into view before it is read
    const frameEl = page.locator('iframe[src^="/api/admin/newsletters/"]');
    await expect(frameEl).toBeAttached();
    await frameEl.scrollIntoViewIfNeeded();
    const iframe = page.frameLocator('iframe[src^="/api/admin/newsletters/"]');
    await expect(iframe.locator("body")).toContainText("Это тестовая рассылка магазина", { timeout: 20_000 });
    await expect(iframe.locator("body")).toContainText(PRODUCT.brand);
    await expect(iframe.locator("body")).toContainText("Отписаться");

    /* ---- Estonian: the same letter in the reader's own language --------- */
    await page.locator('[data-newslang="ET"]').click();
    await expect(page.locator('[data-newslang="ET"]')).toHaveAttribute("aria-current", "true");
    await page.locator('[data-newsf="subject"]').fill(`E2E teema ${tag}`);
    await page.locator("[data-blogbody]").click();
    await page.keyboard.type("Tere! See on poe testkiri.");
    await page.locator("[data-newssave]").click();
    expect(await toastText(page)).toContain("Черновик сохранён");
    await clearToast(page);
    await assertClean(page, w, "newsletter editor");
    await page.screenshot({ path: testInfo.outputPath("news-editor.png"), fullPage: true });

    /* ---- «Отправить мне тест»: the Estonian one, [test] on the subject -- */
    const me = freshEmail("news-me");
    await page.locator("[data-newsto]").fill(me);
    await page.locator("[data-newstest]").click();
    expect(await toastText(page)).toContain("Тест отправлен");
    await clearToast(page);
    await expect.poll(async () => (await captured(page, me)).length, { timeout: 10_000 }).toBe(1);
    const mine = (await captured(page, me))[0];
    expect(mine.subject).toBe(`[test] E2E teema ${tag}`);
    expect(mine.links.some((l) => l.includes("/api/mail/unsubscribe/")), "the test letter has no unsubscribe link").toBe(true);

    /* ---- the send: the card names the count, then the count climbs ----- */
    const sendButton = page.locator("[data-newssend]");
    await expect(sendButton).toContainText("Отправить");
    await sendButton.click();
    const apply = page.locator("[data-admapply]");
    await expect(apply).toBeVisible();
    await expect(page.locator(".adm-confirm__d")).toContainText("уйдёт подписчикам");
    // the card fades in — finished first, or the picture shows it half-drawn
    await page.screenshot({ path: testInfo.outputPath("news-confirm.png"), animations: "disabled" });
    await apply.click();

    // done: the letter is read-only and says what happened
    await expect(page.locator(".adm-badge--ok", { hasText: "Отправлено" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-newssave]"), "a sent letter still offers «Сохранить»").toHaveCount(0);
    await expect(page.locator("[data-blogbody]"), "a sent letter is still editable").toHaveCount(0);
    await assertClean(page, w, "newsletter sent");
    await page.screenshot({ path: testInfo.outputPath("news-sent.png"), fullPage: true });

    // …and the server agrees: every queued row answered, nobody twice
    const list = await (await page.request.get("/api/admin/newsletters/")).json();
    const row = (list.newsletters as Array<{ title: string; status: string; sentCount: number; failedCount: number; audienceCount: number }>)
      .find((n) => n.title === `E2E рассылка ${tag}`);
    expect(row, "the letter is not in the list").toBeTruthy();
    expect(row!.status).toBe("sent");
    expect(row!.failedCount).toBe(0);
    expect(row!.sentCount).toBe(row!.audienceCount);
    expect(row!.sentCount).toBeGreaterThanOrEqual(2);

    // the Russian reader got the Russian letter, the Estonian reader the Estonian one — each with «Отписаться»
    const ru = await captured(page, ruReader);
    const et = await captured(page, etReader);
    expect(ru.filter((m) => m.subject === `E2E тема ${tag}`)).toHaveLength(1);
    expect(et.filter((m) => m.subject === `E2E teema ${tag}`)).toHaveLength(1);
    for (const m of [...ru, ...et]) {
      expect(m.links.some((l) => l.includes("/api/mail/unsubscribe/")), `${m.to[0]}: no unsubscribe link`).toBe(true);
    }

    /* ---- back to the list: the row says «Отправлено» ------------------- */
    await page.locator("[data-newsback]").click();
    const sentRow = page.locator("[data-newsedit]", { hasText: `E2E рассылка ${tag}` });
    await expect(sentRow).toBeVisible();
    await expect(sentRow.locator(".adm-badge--ok")).toHaveText("Отправлено");
    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "the newsletter list spills sideways at 375 px").toBeLessThanOrEqual(1);
    }
    await assertClean(page, w, "newsletter list after the send");
  });

  test("a letter with nothing in it is refused, and a draft can be thrown away", async ({ page }) => {
    const w = watch(page);
    await loginAsAdmin(page);
    await adminSection(page, "promos", "news");
    await page.locator("[data-newsnew]").click();
    await page.locator('[data-newsf="title"]').fill("E2E пустое письмо");
    await page.locator("[data-newssend]").click();
    expect(await toastText(page)).toContain("Сначала заполните тему и текст");
    await expect(page.locator("[data-admapply]"), "an empty letter reached the confirm card").toHaveCount(0);
    await clearToast(page);

    await page.locator("[data-newssave]").click();
    expect(await toastText(page)).toContain("Черновик сохранён");
    await clearToast(page);
    await page.locator("[data-newsdel]").click();
    await page.locator("[data-newsdelyes]").click();
    expect(await toastText(page)).toContain("Письмо удалено");
    await expect(page.locator("[data-newsnew]")).toBeVisible();
    await expect(page.locator("[data-newsedit]", { hasText: "E2E пустое письмо" })).toHaveCount(0);
    await assertClean(page, w, "empty letter refused, draft deleted");
    // the storefront is untouched by any of this
    await page.goto(shopUrl("", "/"));
    await expect(page.locator("body")).toBeVisible();
  });
});
