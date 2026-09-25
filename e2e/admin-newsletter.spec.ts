import { expect, type Locator, type Page, test } from "@playwright/test";
import { adminSection, cardBack, freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl } from "./fixtures";
import { assertClean, clearToast, toastText, watch } from "./sweep-helpers";

/**
 * «Маркетинг → Рассылка» — the owner's own letter, end to end, desktop and
 * mobile: two subscribers tick the box at the checkout, the owner builds a
 * letter out of blocks the way Renat's Aromatic 89 example is built — a
 * picture from the phone that clicks through to a product, a line of text,
 * a button, a product card — in Russian and Estonian, watches it take shape
 * in the live preview, sends himself a test, and sends it: through the
 * confirm card that names the count, the climbing progress, and the
 * read-only «Отправлено» that follows.
 *
 * The picture: this suite has no bucket (playwright.config.ts), so the upload
 * route is answered from here — the picker, the progress and the block are
 * what is tested, not R2. The route's own output (a baseline JPEG, 1200 px,
 * never a WebP) is pinned in tests/upload-news.test.ts.
 *
 * Reading the letters back: the suite runs with no RESEND_API_KEY, so
 * nothing is really sent; `GET /api/e2e/mail/` is the readout of what
 * sendMail() was asked to send (docs/testing.md, «The test-only doors»), and
 * under the same double gate the newsletter counts a sink delivery as sent
 * (src/lib/newsletters.ts e2eSinkTransport) — which is what lets this test
 * watch a real send finish. The sink records the recipient, the subject
 * and the links in the plain-text part — enough to prove the Estonian
 * reader got the Estonian letter, the banner led to the Estonian product
 * page, and every letter carried «Отписаться».
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "newsletter — desktop and mobile projects, see docs/testing.md");
});

/** A 1×1 PNG — the upload route is stubbed, so only the picker's contract matters. */
/* «Как увидит покупатель» is an <iframe sandbox> without allow-scripts, and the
   letter it shows carries no script at all. Playwright itself injects its
   helpers into every frame, and Chromium refuses them in a sandboxed one with
   «Blocked script execution in 'about:srcdoc'…» — a line about the test
   harness, not the shop, so it and nothing else is forgiven here. */
const SANDBOXED_PREVIEW = /^Blocked script execution in 'about:(srcdoc|blank)' because the document's frame is sandboxed/;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/** What the stubbed bucket answers with — a picture this shop serves itself, so the preview can draw it. */
const PHOTO_URL = `/shop/img/${PRODUCT.id}-0.webp?v=5`;

/** No bucket in this suite: the probe says «configured», an upload answers with PHOTO_URL. */
async function stubMedia(page: Page): Promise<string[]> {
  const kinds: string[] = [];
  await page.route("**/api/admin/upload/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, configured: true, cutout: false, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
      return;
    }
    /* Chromium does not always hand a multipart body with a file in it to the
       route — "?" then, and the kind is pinned by the unit test instead
       (tests/newsletter-editor-client.test.ts, newsXhrUpload). */
    let body = "";
    try { body = req.postDataBuffer()?.toString("latin1") || ""; } catch { body = ""; }
    kinds.push(/name="kind"\r\n\r\n(\w+)/.exec(body)?.[1] || "?");
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, key: "news/1-e2e.jpg", url: PHOTO_URL, width: 1, height: 1, bytes: 10, contentType: "image/jpeg" }) });
  });
  return kinds;
}

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

/**
 * The draft saves itself (1a): a second after the last keystroke, at once for
 * a block moved or added. Resolves on the write that carries `carrying` —
 * register it BEFORE the edit it waits for.
 */
function draftSaved(page: Page, carrying: string): Promise<unknown> {
  return page.waitForResponse((r) => {
    const m = r.request().method();
    return r.url().includes("/api/admin/newsletters/") && !r.url().includes("/preview/") && (m === "POST" || m === "PATCH") &&
      (r.request().postData() || "").includes(carrying) && r.ok();
  }, { timeout: 20_000 });
}

/** The blocks on screen, top to bottom, by kind. */
function blockKinds(page: Page): Promise<string[]> {
  return page.locator("[data-nbcard]").evaluateAll((els) =>
    els.map((el) => (el.className.match(/adm-nb--(\w+)/) || [])[1] || "?"));
}

/** Opens the block's «Куда ведёт …» picker, searches, and taps the row that leads to `to`. */
async function pickLink(card: Locator, query: string, to: string): Promise<void> {
  await card.locator('[data-nb="pick"]').click();
  const picker = card.locator("[data-nbpick]");
  await expect(picker).toBeVisible();
  if (query) await picker.locator('[data-nbf="q"]').fill(query);
  /* Straight from the search box, the keyboard still up: on a phone the
     pinned «Отправить» used to come back between the press and the release
     and take the release (app.js, admPressing) */
  await picker.locator(`[data-nb="to"][data-v="${to}"]`).click();
  await expect(card.locator("[data-nbpick]"), "the picker stayed open after a pick").toHaveCount(0);
}

test.describe("admin — newsletter", () => {
  test.use({ extraHTTPHeaders: ipHeaders(190) });

  test("a letter is built out of blocks in two languages, tested, sent to the subscribers and read back", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const w = watch(page);
    w.allow.push(SANDBOXED_PREVIEW);
    const mobile = testInfo.project.name === "mobile";
    const tag = Date.now().toString().slice(-6);
    const ruReader = freshEmail("news-ru");
    const etReader = freshEmail("news-et");
    await subscribe(page, ruReader, "RU");
    await subscribe(page, etReader, "ET");
    const uploads = await stubMedia(page);

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
    await expect(page.locator("#newsblocks"), "the letter has no block editor").toBeVisible();
    await expect(page.locator("[data-blogbody]"), "the old rich-text box is still there").toHaveCount(0);
    // the very sentence Renat stopped at (23.09.2026) must not be on this screen
    await expect(page.locator("body")).not.toContainText("Загрузка картинок пока не настроена");

    await page.locator('[data-newsf="title"]').fill(`E2E рассылка ${tag}`);
    await page.locator('[data-newsf="subject"]').fill(`E2E тема ${tag}`);

    /* ---- «+ Картинка»: the phone's own picker, then the picture's link --- */
    const chooser = page.waitForEvent("filechooser");
    await page.locator('[data-nb="add"][data-v="img"]').click();
    await (await chooser).setFiles({ name: "banner.png", mimeType: "image/png", buffer: PNG });
    const pic = page.locator("[data-nbcard].adm-nb--img").first();
    await expect(pic.locator(`.adm-nb__pic img[src="${PHOTO_URL}"]`), "the uploaded picture is not in its block").toBeVisible({ timeout: 15_000 });
    expect(uploads, "one picture, one upload").toHaveLength(1);
    expect(["news", "?"], "the picture did not go up as a letter's picture").toContain(uploads[0]);
    await pickLink(pic, PRODUCT.id, `product:${PRODUCT.id}`);
    await expect(pic.locator(".adm-nb__target")).toContainText(PRODUCT.brand);

    /* ---- «+ Текст», «+ Кнопка», «+ Товар» -------------------------------- */
    await page.locator('[data-nb="add"][data-v="text"]').click();
    const text = page.locator("[data-nbcard].adm-nb--text").first();
    await text.locator('[data-nbf="text"]').fill("Привет! Это тестовая рассылка магазина.");

    await page.locator('[data-nb="add"][data-v="btn"]').click();
    const btn = page.locator("[data-nbcard].adm-nb--btn").first();
    await btn.locator('[data-nbf="label"]').fill("В магазин");
    await pickLink(btn, "", "home");

    await page.locator('[data-nb="add"][data-v="product"]').click();
    const addPicker = page.locator('[data-nbpick="add"]');
    await addPicker.locator('[data-nbf="q"]').fill(PRODUCT.id);
    await addPicker.locator(`[data-nb="to"][data-v="product:${PRODUCT.id}"]`).click();
    expect(await blockKinds(page)).toEqual(["img", "text", "btn", "product"]);

    // the text goes above the picture: one tap on its ↑ — saved at once, text first
    const moved = draftSaved(page, '"blocks":[{"t":"text"');
    await text.locator('[data-nb="up"]').click();
    expect(await blockKinds(page)).toEqual(["text", "img", "btn", "product"]);
    await moved;
    // no «not saved» line and no «Сохранить» — the draft saves itself (1a)
    await expect(page.locator("[data-newsdirty]")).toHaveCount(0);
    await expect(page.locator("[data-newssave]")).toHaveCount(0);

    /* ---- the live preview is the letter, before anything is saved -------- */
    const frameEl = page.locator("[data-nbframe]");
    await frameEl.scrollIntoViewIfNeeded();
    const letter = page.frameLocator("[data-nbframe]");
    await expect(letter.locator("body")).toContainText("Это тестовая рассылка магазина", { timeout: 20_000 });
    await expect(letter.locator("body")).toContainText("В магазин");
    await expect(letter.locator("body")).toContainText(PRODUCT.brand);
    await expect(letter.locator("body")).toContainText("Отписаться");
    // the banner is a link to the product it was pointed at
    await expect(letter.locator(`a[href$="/shop2/p/${PRODUCT.id}/"] img`).first()).toBeAttached();

    /* ---- Estonian: the same blocks, the reader's own words ---------------- */
    await page.locator('[data-newslang="ET"]').click();
    await expect(page.locator('[data-newslang="ET"]')).toHaveAttribute("aria-current", "true");
    // «Перевести с русского» sits on the ET and EN tabs (README § 1)
    await expect(page.locator("[data-newstranslate]")).toBeVisible();
    const etSaved = draftSaved(page, "Poodi");
    await page.locator('[data-newsf="subject"]').fill(`E2E teema ${tag}`);
    await page.locator('[data-nbcard].adm-nb--text [data-nbf="text"]').fill("Tere! See on poe testkiri.");
    await page.locator('[data-nbcard].adm-nb--btn [data-nbf="label"]').fill("Poodi");
    await etSaved;
    await expect(page.frameLocator("[data-nbframe]").locator("body")).toContainText("Tere! See on poe testkiri", { timeout: 20_000 });
    await assertClean(page, w, "newsletter editor");
    await page.screenshot({ path: testInfo.outputPath("news-editor.png"), fullPage: true });

    /* ---- «Отправить мне тест»: the Estonian one, [test] on the subject -- */
    const me = freshEmail("news-me");
    await page.locator("[data-newsto]").fill(me);
    // the answer first: toastText waits three seconds, a loaded dev server takes longer to send
    const tested = page.waitForResponse((r) => r.url().includes("/test/") && r.request().method() === "POST", { timeout: 30_000 });
    await page.locator("[data-newstest]").click();
    await tested;
    expect(await toastText(page)).toContain("Тест отправлен");
    await clearToast(page);
    await expect.poll(async () => (await captured(page, me)).length, { timeout: 30_000 }).toBe(1);
    const mine = (await captured(page, me))[0];
    expect(mine.subject).toBe(`[test] E2E teema ${tag}`);
    expect(mine.links.some((l) => l.includes("/api/mail/unsubscribe/")), "the test letter has no unsubscribe link").toBe(true);
    expect(mine.links.some((l) => l.includes(`/shop2/et/p/${PRODUCT.id}/`)), "the banner does not lead to the Estonian product page").toBe(true);

    /* ---- the send: the card names the count, then the count climbs ----- */
    const sendButton = page.locator("[data-newssend]");
    await expect(sendButton).toContainText("Отправить");
    await sendButton.click();
    const apply = page.locator("[data-admapply]");
    await expect(apply).toBeVisible();
    // the question names the count (README rule 4)
    await expect(page.locator(".adm-confirm__t")).toContainText("подписчик");
    await expect(page.locator(".adm-confirm__d")).toContainText("уйдёт подписчикам");
    // the card fades in — finished first, or the picture shows it half-drawn
    await page.screenshot({ path: testInfo.outputPath("news-confirm.png"), animations: "disabled" });
    /* …then ten seconds in the panel with «Вернуть» (Dim, q3): nothing is
       sent until they are up */
    let sends = 0;
    page.on("request", (r) => { if (r.url().includes("/send/") && r.method() === "POST") sends += 1; });
    await apply.click();
    await expect(page.locator("[data-newsholdleft]")).toBeVisible();
    await expect(page.locator("[data-newsholdundo]")).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(sends, "the send did not wait for its ten seconds").toBe(0);

    // done: the letter is read-only and says what happened
    await expect(page.locator(".adm-badge--ok", { hasText: "Отправлено" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-newssave]"), "a sent letter still offers «Сохранить»").toHaveCount(0);
    await expect(page.locator("#newsblocks"), "a sent letter is still editable").toHaveCount(0);
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
    await cardBack(page, "[data-newsback]", "Рассылка").click();
    const sentRow = page.locator("[data-newsedit]", { hasText: `E2E рассылка ${tag}` });
    await expect(sentRow).toBeVisible();
    await expect(sentRow.locator(".adm-badge--ok")).toHaveText("Отправлено");
    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "the newsletter list spills sideways at 375 px").toBeLessThanOrEqual(1);
    }
    await assertClean(page, w, "newsletter list after the send");
  });

  test("a block can be deleted and brought back; a letter with nothing in it is refused, and a draft can be thrown away", async ({ page }, testInfo) => {
    const w = watch(page);
    w.allow.push(SANDBOXED_PREVIEW);
    await stubMedia(page);
    await loginAsAdmin(page);
    await adminSection(page, "promos", "news");
    await page.locator("[data-newsnew]").click();
    await page.locator('[data-newsf="title"]').fill("E2E пустое письмо");

    // ✕ takes a block away, the toast's «Вернуть» puts it back where it stood (1a rule 3)
    await page.locator('[data-nb="add"][data-v="text"]').click();
    await page.locator('[data-nbcard].adm-nb--text [data-nbf="text"]').fill("Удалю и верну");
    await page.locator('[data-nbcard].adm-nb--text [data-nb="del"]').click();
    await expect(page.locator("[data-nbcard]")).toHaveCount(0);
    await page.getByRole("status").locator("[data-admtoastundo]").click();
    await expect(page.locator('[data-nbcard].adm-nb--text [data-nbf="text"]')).toHaveValue("Удалю и верну");
    await page.locator('[data-nbcard].adm-nb--text [data-nb="del"]').click();

    // a button with nowhere to go is named before anything is sent
    await page.locator('[data-newsf="subject"]').fill("E2E тема");
    await page.locator('[data-nb="add"][data-v="btn"]').click();
    await page.locator('[data-nbcard].adm-nb--btn [data-nbf="label"]').fill("Смотреть");
    await page.locator('[data-nb="add"][data-v="text"]').click();
    await page.locator('[data-nbcard].adm-nb--text [data-nbf="text"]').fill("Текст есть");
    // the send is the one dark button — out of the way on a phone while the keyboard is up
    await page.locator('[data-nbcard].adm-nb--text [data-nbf="text"]').blur();
    await page.locator("[data-newssend]").click();
    expect(await toastText(page)).toContain("У кнопки не выбрано, куда она ведёт");
    await expect(page.locator("[data-admapply]"), "a letter with a dead button reached the confirm card").toHaveCount(0);
    await clearToast(page);
    await page.locator('[data-nbcard].adm-nb--btn [data-nb="del"]').click();
    await page.locator('[data-nbcard].adm-nb--text [data-nb="del"]').click();
    await page.locator('[data-newsf="subject"]').fill("");
    await page.locator('[data-newsf="subject"]').blur();

    await page.locator("[data-newssend]").click();
    expect(await toastText(page)).toContain("Сначала заполните тему и текст");
    await expect(page.locator("[data-admapply]"), "an empty letter reached the confirm card").toHaveCount(0);
    await clearToast(page);

    // the draft saved itself — the server has it, title and all
    await expect.poll(async () => {
      const l = await (await page.request.get("/api/admin/newsletters/")).json();
      return (l.newsletters as Array<{ title: string }>).some((n) => n.title === "E2E пустое письмо");
    }, { timeout: 20_000 }).toBe(true);
    if (testInfo.project.name === "mobile") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "the block editor spills sideways at 375 px").toBeLessThanOrEqual(1);
    }
    // «⋯ → Удалить письмо», the confirm sheet, then five seconds of «Вернуть» (q8)
    await page.locator("[data-newsmenu]").click();
    await page.locator("[data-newsdel]").click();
    await expect(page.locator(".adm-confirm")).toBeVisible();
    const gone = page.waitForResponse((r) => r.url().includes("/api/admin/newsletters/") && r.request().method() === "DELETE", { timeout: 20_000 });
    await page.locator("[data-admapply]").click();
    expect(await toastText(page)).toContain("Письмо удалено");
    expect((await gone).ok()).toBe(true);
    await expect(page.locator("[data-newsnew]")).toBeVisible();
    await expect(page.locator("[data-newsedit]", { hasText: "E2E пустое письмо" })).toHaveCount(0);
    await assertClean(page, w, "empty letter refused, draft deleted");
    // the storefront is untouched by any of this
    await page.goto(shopUrl("", "/"));
    await expect(page.locator("body")).toBeVisible();
  });
});
