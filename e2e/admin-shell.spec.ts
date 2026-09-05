import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

test.beforeEach(async ({}, testInfo) => {
  // phone + desktop are the two designed layouts (docs/design/admin-handoff-README.md);
  // the tablet project gets whichever breakpoint applies and is not asserted here
  test.skip(testInfo.project.name === "tablet", "admin shell spec — desktop and mobile projects only");
});

/**
 * The redesigned admin shell — phase 1 of docs/design/admin-handoff-README.md.
 *
 * What this file is for: the IA itself. Thirteen flat tabs became five places
 * (Обзор · Заказы · Товары · Салон · Ещё), the assistant left its permanent
 * third column for a floating button, and the confirm card and the toast grew
 * teeth (an overlay, and an «Отменить» that writes its own journal line). None
 * of that is covered by the section specs, which test what each screen *does*;
 * this one tests that the owner can still get to every screen, from a phone as
 * well as a laptop, and that the two safety mechanisms behave.
 *
 * Both projects on purpose — unlike every other admin spec (docs/testing.md
 * "Why most specs run on desktop only"). The whole point of the redesign is
 * that Renat works from an iPhone, so the phone half is the half that matters:
 * the sticky bottom bar, the «Ещё» sheet, the assistant as a sheet.
 *
 * Every test has its own fake IP: admin login is rate-limited 5/min.
 */

/** The nav item for a section, on whichever nav this viewport shows. */
function nav(page: Page, key: string) {
  return page.locator(`[data-admtab="${key}"][aria-current]:visible`).first();
}
/** The six sections behind «Ещё» on a phone (ADM_MORE in app.js). */
const MORE = ["people", "promos", "blog", "stats", "apps", "setup"];

test.describe("admin shell — the five places", () => {
  test.use({ extraHTTPHeaders: ipHeaders(120) });

  test("phone: a sticky bottom bar with five items, and «Ещё» opens the rest", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the bottom bar is the phone nav");
    await loginAsAdmin(page);

    const bar = page.locator(".adm-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(".adm-bar__i")).toHaveCount(5);
    // …and it is stuck to the bottom of the viewport, not to the end of a page
    // hundreds of products long
    const box = await bar.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box, "the bottom bar has no box at all").not.toBeNull();
    expect(Math.abs((box!.y + box!.height) - vh), "the bottom bar is not at the bottom").toBeLessThan(2);

    // «Ещё» → the sheet with the six sections that are not on the bar
    await page.locator("[data-admmore]").click();
    const sheet = page.locator(".adm-sheet");
    await expect(sheet).toBeVisible();
    for (const label of ["Клиенты", "Маркетинг", "Блог", "Аналитика", "Подключения", "Настройки"]) {
      await expect(sheet.getByText(label, { exact: true })).toBeVisible();
    }
    // its footer: the language switch, the shop and the way out
    await expect(sheet.locator(".adm-langs button")).toHaveCount(3);
    await expect(sheet.getByText("Магазин ↗")).toBeVisible();
    await expect(sheet.locator("[data-admlogout]")).toBeVisible();

    // a row opens its section and closes the sheet behind it
    await page.locator('.adm-sheet [data-admtab="blog"]').click();
    await expect(page.locator(".adm-sheet")).toHaveCount(0);
    await expect(page.locator("h1.adm-h1")).toHaveText("Блог");

    // the scrim closes it without going anywhere
    await page.locator("[data-admmore]").click();
    await expect(page.locator(".adm-sheet")).toBeVisible();
    await page.locator("[data-admmoreclose]").click({ position: { x: 20, y: 20 } });
    await expect(page.locator(".adm-sheet")).toHaveCount(0);
    await expect(page.locator("h1.adm-h1")).toHaveText("Блог");
  });

  test("desktop: the sidebar folds to icons and stays folded", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the sidebar is the desktop nav");
    await loginAsAdmin(page);

    /* Poll rather than measure once: the sidebar is rebuilt by every render,
       and a background probe landing between the visibility check and the
       measurement detaches the node the box was asked for. It also has a
       .2 s width transition to settle. */
    const width = async () => {
      const box = await page.locator(".adm-side").boundingBox();
      return box ? Math.round(box.width) : 0;
    };
    // 232 px expanded, 68 px folded (README § Design tokens)
    await expect.poll(width).toBe(232);
    await expect(page.locator(".adm-side").getByText("Обзор", { exact: true })).toBeVisible();

    await page.locator("[data-admnav]").click();
    await expect(page.locator("[data-admnav]")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(width).toBe(68);
    // labels gone, the icons and their titles still there to click
    await expect(page.locator(".adm-side").getByText("Обзор", { exact: true })).toBeHidden();
    await expect(nav(page, "orders")).toBeVisible();

    await page.locator("[data-admnav]").click();
    await expect.poll(width).toBe(232);
  });
});

test.describe("admin shell — every old tab key is still a deep link", () => {
  test.use({ extraHTTPHeaders: ipHeaders(121) });

  /** old key → the section it lives in now, and the title that section shows. */
  const KEYS: Array<[string, string, string]> = [
    ["over", "over", "Обзор"],
    ["orders", "orders", "Заказы"],
    ["goods", "goods", "Товары"],
    ["stock", "goods", "Товары"],
    // the nav item is «Салон»; the screen it opens is titled «Продажа в салоне»
    ["pos", "pos", "Продажа в салоне"],
    ["people", "people", "Клиенты"],
    ["reviews", "people", "Клиенты"],
    ["promos", "promos", "Маркетинг"],
    ["mail", "promos", "Маркетинг"],
    ["blog", "blog", "Блог"],
    ["stats", "stats", "Аналитика"],
    ["apps", "apps", "Подключения"],
    ["setup", "setup", "Настройки"],
  ];

  test("all thirteen open their section, whichever viewport", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mobile = testInfo.project.name === "mobile";
    await loginAsAdmin(page);

    for (const [key, section, title] of KEYS) {
      /* Exactly what the assistant's «Открыть …» buttons do: reach a section
         by the old key. A section of its own is one click in the nav — on a
         phone, six of them live behind «Ещё»; a key that moved into a sub-tab
         is that section plus its tab. The keys are ordered so a sub-tab always
         follows its own section, which is why the section is usually open
         already by the time its second key comes round. */
      const open = await page.locator(`[data-admtab="${section}"][aria-current="true"]:visible`).count();
      if (!open) {
        if (mobile && MORE.indexOf(section) >= 0) await page.locator("[data-admmore]").click();
        await page.locator(`[data-admtab="${section}"][aria-current]:visible`).first().click();
      }
      if (key !== section) await page.locator(`.adm-tabs [data-admtab="${key}"]`).click();

      /* What is marked current: the section's own control where the viewport
         has one — on a phone the six «Ещё» sections have no bar item of their
         own, so «Ещё» itself is what lights up. */
      const marked = mobile && MORE.indexOf(section) >= 0 && key === section
        ? page.locator('[data-admmore][aria-current="true"]')
        : page.locator(`[data-admtab="${key}"][aria-current="true"]:visible`).first();
      await expect(marked, `${key} is not marked current`).toBeVisible();
      await expect(page.locator("h1.adm-h1").first(), `${key} did not open ${title}`).toHaveText(new RegExp(title));
    }
  });
});

test.describe("admin shell — the assistant", () => {
  test.use({ extraHTTPHeaders: ipHeaders(122) });

  test("a floating button opens it, it answers a question, and it folds away", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile";
    await loginAsAdmin(page);

    // closed by default — the third column is gone (README fix #8)
    await expect(page.locator(".adm-asst")).toHaveCount(0);
    const fab = page.locator(".adm-fab");
    await expect(fab).toBeVisible();
    await fab.click();

    // one markup, two shapes: a 380-px column beside the work on a desktop,
    // a 75 %-tall sheet over it on a phone
    const panel = page.locator(".adm-asst");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    if (mobile) expect(Math.round(box.height / page.viewportSize()!.height * 100)).toBe(75);
    else expect(Math.round(box.width)).toBe(380);
    // the FAB steps aside while the panel is up
    await expect(page.locator(".adm-fab")).toHaveCount(0);

    // a question, in plain words, gets a plain answer
    await panel.locator("[data-admq]").fill("Какие заказы ждут отправки?");
    await panel.locator("[data-admsend]").click();
    const answer = page.locator("[data-aians]");
    await expect(answer).toBeVisible();
    expect(((await answer.textContent()) || "").trim().length, "the assistant said nothing").toBeGreaterThan(0);
    // and the question itself is echoed as the owner's own bubble
    await expect(page.locator(".adm-msg--me")).toContainText("Какие заказы ждут отправки?");

    // one of the suggestion chips asks for you
    await panel.locator("[data-admask]").first().click();
    await expect(page.locator("[data-aians]")).toBeVisible();

    await panel.locator(".adm-asst__fold").click();
    await expect(page.locator(".adm-asst")).toHaveCount(0);
    await expect(page.locator(".adm-fab")).toBeVisible();
  });
});

/* The assistant's two new promises (docs/assistant-work.md): what the owner
   reads is always a sentence — never the raw JSON of a cut answer — and a
   photo attached to the conversation is filed where he says. Both routes
   are stubbed at the network edge: the suite has no OpenAI key and no
   bucket, and what is under test is the panel — how it reads a bad answer,
   what it uploads, what it sends, what the confirm card applies. */
test.describe("admin shell — the assistant never shows JSON, and files a photo", () => {
  test.use({ extraHTTPHeaders: ipHeaders(128) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport is enough — the panel's logic is viewport-independent");
  });

  /** A 1×1 PNG — the upload route is stubbed, so only the picker's contract matters. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const PHOTO_URL = "/shop/img/system-4-bio-botanical-shampoo-0.webp?v=5";
  const KEY = "products/inbox/1-e2e.webp";

  test("a cut or JSON-looking answer is a sentence with «Спросить ещё раз», never the raw text", async ({ page }) => {
    let n = 0;
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
      }
      n++;
      // 1: the body itself is a JSON document cut mid-way — what a stale deployment relayed raw
      if (n === 1) return route.fulfill({ status: 200, contentType: "application/json", body: '{"reply":"Написал черновик статьи об уходе за бородой","action":{"type":"draft_post","title":{"RU":"Как ух' });
      // 2: valid JSON whose reply is itself JSON text
      if (n === 2) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: '{"reply":"вложенный","action":{}}', product_ids: [], tab: "" }) });
      // 3: a proper answer
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Всё в порядке — заказов на отправку нет.", product_ids: [], tab: "orders" }) });
    });

    await loginAsAdmin(page);
    await page.locator(".adm-fab").click();
    await page.locator("[data-admq]").fill("у меня новый пост в блоге, напиши мне текст");
    await page.locator("[data-admsend]").click();
    const answer = page.locator("[data-aians]");
    await expect(answer).toContainText("спросите ещё раз");
    expect((await answer.textContent()) || "", "the panel printed the raw JSON").not.toMatch(/[{}]/);
    const retry = answer.locator("[data-admretry]");
    await expect(retry).toBeVisible();

    await retry.click();
    await expect(answer).toContainText("спросите ещё раз");
    expect((await answer.textContent()) || "", "a JSON-looking reply reached the screen").not.toMatch(/[{}]/);
    await expect(answer.locator("[data-admretry]")).toBeVisible();

    await answer.locator("[data-admretry]").click();
    await expect(answer).toContainText("Всё в порядке — заказов на отправку нет.");
    await expect(answer.locator("[data-admretry]")).toHaveCount(0);
    expect(n).toBe(3);
  });

  test("an attached photo is uploaded, told to the assistant, and its confirm card makes it the product's main photo", async ({ page }) => {
    test.setTimeout(90_000);
    const uploads: string[] = [];
    await page.route("**/api/admin/upload/**", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, configured: true, cutout: false, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
      }
      if (req.method() === "DELETE") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      uploads.push(req.headers()["content-type"] || "");
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, key: KEY, url: PHOTO_URL, thumbUrl: PHOTO_URL, width: 1, height: 1, bytes: 10, alt: "" }) });
    });
    const asked: Array<{ attachments?: Array<{ key: string; name: string }>; messages?: Array<{ content: string }> }> = [];
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
      }
      const body = route.request().postDataJSON() as (typeof asked)[number];
      asked.push(body);
      const att = body.attachments && body.attachments[0];
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(att
          ? { reply: "Ставлю это фото главным у Kevin.Murphy Un.Tangled Spray — подтвердите; отменить можно в журнале.", product_ids: [], tab: "goods",
              action: { type: "add_product_photo", id: PRODUCT_2.id, key: att.key, main: true } }
          : { reply: "Прикрепите фото скрепкой рядом с вопросом.", product_ids: [], tab: "goods" }),
      });
    });

    await loginAsAdmin(page);
    try {
      await page.locator(".adm-fab").click();
      await page.locator("[data-admfile]").setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: PNG });
      const strip = page.locator("[data-admattlist]");
      await expect(strip.locator(".adm-att__i")).toHaveCount(1);
      await expect.poll(() => uploads.length, "the photo was not uploaded on attach").toBe(1);
      expect(uploads[0]).toContain("multipart/form-data");
      await expect(strip.locator(".adm-att__img")).toHaveAttribute("style", new RegExp(PHOTO_URL.replace(/[.?]/g, "\\$&")));

      await page.locator("[data-admq]").fill("вот фото для Un.Tangled Spray, сделай главным");
      await page.locator("[data-admsend]").click();
      const answer = page.locator("[data-aians]");
      await expect(answer).toContainText("Ставлю это фото главным");
      expect(asked[0].attachments, "the assistant was not told the uploaded key").toEqual([{ key: KEY, name: "e2e.png" }]);

      const card = answer.locator(".adm-propose");
      await expect(card).toContainText("Главное фото");
      await expect(card).toContainText("Un.Tangled Spray");
      await card.locator("[data-admapply]").click();
      await expect(page.getByRole("status").first()).toContainText("Главное фото поставлено");
      // the photo left the strip — it lives in the product's gallery now
      await expect(strip).toHaveCount(0);
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        const g = ((body.overrides || {})[PRODUCT_2.id] || {}).gallery as Array<{ url: string }> | null;
        return g && g[0] ? g[0].url : null;
      }, { timeout: 15_000, message: "the overrides feed never carried the new main photo" }).toBe(PHOTO_URL);
    } finally {
      // back to the catalogue photos: this suite leaves the product as it found it
      await page.request.put("/api/admin/overrides/", { data: { id: PRODUCT_2.id, gallery: [] } });
    }
  });
});

test.describe("admin shell — Обзор counts a paid order", () => {
  test.use({ extraHTTPHeaders: ipHeaders(123) });

  test("«Сделать сегодня» names the queue and its row opens Заказы on «Новые»", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one order is enough; the counts are viewport-independent");
    test.setTimeout(90_000);

    // a real paid order for the queue to count
    await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("shell-over"), "paid");

    await loginAsAdmin(page);
    // the queue row: an Oswald count, the plural that matches it, the names
    const row = page.locator('.adm-list [data-admtab="orders"][data-admfilter="new"]').first();
    await expect(row).toBeVisible();
    const n = Number(((await row.locator(".adm-row__big").textContent()) || "0").trim());
    expect(n, "the queue did not count the paid order").toBeGreaterThan(0);
    await expect(row.locator(".adm-row__nm"))
      .toHaveText(n === 1 ? "заказ ждёт отправки" : /заказ(а|ов) ждут отправки/);
    // …and the header's own «Отправить N» agrees with it
    await expect(page.locator('.adm-head [data-admtab="orders"]')).toHaveText(`Отправить ${n}`);

    // the row is the way in: Заказы, already filtered to «Новые»
    await row.click();
    await expect(page.locator('[data-admfilter="new"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();
  });
});

test.describe("admin shell — Заказы filters and the ship flow", () => {
  test.use({ extraHTTPHeaders: ipHeaders(124) });

  test("chips filter the list, and «Отправлен» goes through the confirm card into the journal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the flow is the same on both; one run is enough");
    test.setTimeout(120_000);

    await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("shell-orders"), "paid");

    await loginAsAdmin(page);
    await nav(page, "orders").click();

    // «Новые» has it, «Ждут оплаты» does not — and says so rather than showing
    // an empty box
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();

    /* The count on the «Новые» chip and the badge on the nav item are the
       same number as the rows — read off the loaded list, not off the
       overview's cached summary, which used to lag a shipped order. The chip
       is one text node («Новые 2»), which is why it needs its own rule to be
       translated: on the Estonian panel it reads «Uued 2», not «Новые 2». */
    const chip = page.locator('[data-admfilter="new"]');
    await expect(chip).toHaveText(/^Новые \d+$/);
    const waiting = Number(((await chip.textContent()) || "").replace(/\D+/g, ""));
    expect(waiting, "the chip did not count the paid order").toBeGreaterThan(0);
    await expect(page.locator('.adm-nav[data-admtab="orders"] .adm-nav__badge')).toHaveText(String(waiting));
    await page.locator('.adm-side [data-lang="ET"]').click();
    await expect(chip).toHaveText(`Uued ${waiting}`);
    await page.locator('.adm-side [data-lang="RU"]').click();
    await expect(chip).toHaveText(`Новые ${waiting}`);
    await page.locator('[data-admfilter="unpaid"]').click();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`)).toHaveCount(0);
    await page.locator('[data-admfilter="salon"]').click();
    await expect(page.locator(".adm-empty")).toHaveText("Таких заказов нет");
    await page.locator('[data-admfilter="all"]').click();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();

    // search finds it by number
    await page.locator("[data-admorderq]").fill(number);
    await expect(page.locator("[data-admorder]")).toHaveCount(1);

    /* «Отправлен» from the row: the confirm card first (it moves the money's
       status and sends the customer a letter), then a toast that offers to
       take it back, and a journal line either way. */
    await page.locator("[data-admshipnow]").click();
    const card = page.locator(".adm-confirm");
    await expect(card.locator(".adm-confirm__t")).toHaveText("Отметить отправленным?");
    await expect(card.locator(".adm-confirm__d")).toContainText(number);
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();

    await page.locator("[data-admshipnow]").click();
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toContainText(`${number} отправлен`);
    await expect(page.locator(".adm-toast__undo")).toBeVisible();
    await page.locator("[data-closetoast]").click();

    // …and the chip and the badge follow the shipped order down at once
    const left = waiting - 1;
    await expect(chip).toHaveText(left ? `Новые ${left}` : "Новые");
    await expect(page.locator('.adm-nav[data-admtab="orders"] .adm-nav__badge')).toHaveCount(left ? 1 : 0);
    if (left) await expect(page.locator('.adm-nav[data-admtab="orders"] .adm-nav__badge')).toHaveText(String(left));

    // the list agrees, and so does the journal in «Настройки»
    await page.locator('[data-admfilter="shipped"]').click();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();
    await page.locator('[data-admtab="setup"][aria-current]:visible').first().click();
    // the journal is a page of its own since the phase-3 redesign (README fix #6)
    await page.locator('[data-admsetpage="journal"]').click();
    await expect(page.getByText(`Заказ ${number}: отправлен`)).toBeVisible();
  });
});

/**
 * Once its data has arrived the panel stands still. Every fetch and every
 * state change ends in render(), and a render used to rebuild the whole tree
 * — replaying the entrance fade each time, which the owner saw as «the panel
 * keeps blinking». Now a render patches the DOM in place, so an unchanged
 * screen produces no mutation at all, and nothing polls in the background.
 */
async function still(page: Page, label: string): Promise<void> {
  // let the panel's own start-up fetches land — orders, overview, analytics
  // (each compiles on its first hit under `next dev`) — and their renders paint
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  const calls: string[] = [];
  const onRequest = (r: { url(): string; method(): string }) => {
    if (r.url().includes("/api/")) calls.push(`${r.method()} ${r.url()}`);
  };
  page.on("request", onRequest);
  const mutations = await page.evaluate(() => new Promise<string[]>((resolve) => {
    const root = document.querySelector("main.screen")!;
    const seen: string[] = [];
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target as Element;
        seen.push(`${m.type} ${el.nodeName.toLowerCase()}${(el as Element).className ? "." + String((el as Element).className).split(" ")[0] : ""}${m.attributeName ? "[" + m.attributeName + "]" : ""}`);
      }
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    setTimeout(() => { mo.disconnect(); resolve(seen.slice(0, 20)); }, 5000);
  }));
  page.off("request", onRequest);
  expect(mutations, `${label}: the DOM kept changing while nothing happened`).toEqual([]);
  expect(calls, `${label}: the panel kept fetching while nothing happened`).toEqual([]);
}

test.describe("admin shell — the panel stands still once its data has arrived", () => {
  test.use({ extraHTTPHeaders: ipHeaders(126) });

  test("Обзор and Заказы: no DOM mutation and no request for five seconds", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    await expect(page.locator("h1.adm-h1")).toHaveText("Обзор");
    await still(page, "Обзор");

    // moving to another section plays the entrance fade once (the class is
    // set only when the screen key changes) …
    await nav(page, "orders").click();
    await expect(page.locator("h1.adm-h1")).toHaveText("Заказы");
    await expect(page.locator(".adm-page")).toHaveClass(/adm-page--enter/);
    await expect(page.locator("#orderlist")).toBeVisible();
    // …and then this screen, too, is left alone
    await still(page, "Заказы");
  });
});

/**
 * The phone layout at the width Renat actually holds. Every screen the
 * redesign owns fits the viewport — the page never scrolls sideways (a panel
 * that does is a panel whose bottom bar cannot be tapped) — and every
 * control is a thumb's size: 44 px each way (README § Constraints).
 */
async function fitsThePhone(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const small: string[] = [];
    document.querySelectorAll<HTMLElement>(".adm2 button, .adm2 a").forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;   // hidden, or on the nav this viewport does not show
      if (b.height < 44 || b.width < 44) {
        const name = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
        const text = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24);
        small.push(`${name} ${Math.round(b.width)}×${Math.round(b.height)} «${text}»`);
      }
    });
    return { overflow: doc.scrollWidth - doc.clientWidth, small };
  });
  expect(r.overflow, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(r.small, `${label}: tap targets under 44 px`).toEqual([]);
}

/** A footer's content sits on the footer's own centre line — the group as a
 *  whole (the sheet lays its three items out in one row), and each item on
 *  its own where the footer is a column (the sidebar). */
async function centred(page: Page, selector: string, label: string, each: boolean): Promise<void> {
  const r = await page.locator(selector).evaluate((foot) => {
    const f = foot.getBoundingClientRect();
    const mid = f.left + f.width / 2;
    const kids = Array.from(foot.children).map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
    const left = Math.min(...kids.map((b) => b.left));
    const right = Math.max(...kids.map((b) => b.right));
    return { group: Math.round((left + right) / 2 - mid), each: kids.map((b) => Math.round(b.left + b.width / 2 - mid)) };
  });
  expect(Math.abs(r.group), `${label}: the footer's content is ${r.group}px off centre`).toBeLessThanOrEqual(2);
  if (each) for (const d of r.each) expect(Math.abs(d), `${label}: a footer item is ${d}px off centre`).toBeLessThanOrEqual(2);
}

test.describe("admin shell — the phone fits, and the footers are centred", () => {
  test.use({ extraHTTPHeaders: ipHeaders(127) });

  test("no sideways scroll, 44-px targets, centred footers", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mobile = testInfo.project.name === "mobile";
    await loginAsAdmin(page);

    if (!mobile) {
      // the desktop sidebar's foot: language switch, «Открыть магазин ↗», «Выйти»
      await centred(page, ".adm-side__foot", "sidebar foot", true);
      return;
    }

    await fitsThePhone(page, "Обзор");
    await nav(page, "orders").click();
    await expect(page.locator("#orderlist")).toBeVisible();
    await fitsThePhone(page, "Заказы");
    await page.locator("[data-admorder]").first().click();
    await expect(page.locator('[data-admorder=""]')).toBeVisible();
    await fitsThePhone(page, "Заказ");
    await page.locator('[data-admorder=""]').click();

    await nav(page, "goods").click();
    await expect(page.locator("#goodslist")).toBeVisible();
    await fitsThePhone(page, "Товары");
    await page.locator("[data-goodsq]").fill(PRODUCT_2.id);
    await page.locator(`[data-admgoods="${PRODUCT_2.id}"]`).click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    for (const tab of ["main", "sizes", "media", "desc", "seo"]) {
      await page.locator(`[data-edtab="${tab}"]`).click();
      await expect(page.locator(`[data-edpane="${tab}"]`)).toBeVisible();
      await fitsThePhone(page, `Товар · ${tab}`);
    }
    await page.locator("[data-admclose]").first().click();

    await nav(page, "pos").click();
    await expect(page.locator("[data-posq]")).toBeVisible();
    await fitsThePhone(page, "Салон");

    // the «Ещё» sheet, and the same footer inside it
    await page.locator("[data-admmore]").click();
    await expect(page.locator(".adm-sheet")).toBeVisible();
    await fitsThePhone(page, "Ещё");
    await centred(page, ".adm-sheet__foot", "sheet foot", false);
    await page.locator("[data-admmoreclose]").click({ position: { x: 20, y: 20 } });
    await expect(page.locator(".adm-sheet")).toHaveCount(0);
  });
});

test.describe("admin shell — the Склад stepper and its undo", () => {
  test.use({ extraHTTPHeaders: ipHeaders(125) });

  test("one tap changes the shelf at once; «Отменить» puts it back and says so in the journal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the stepper is the same on both; one run is enough");
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // «Товары» → «Склад», the row for the product this suite is allowed to count
    await nav(page, "goods").click();
    await page.locator('[data-admtab="stock"]:visible').last().click();
    await page.locator("[data-stockq]").fill(PRODUCT_2.id);
    const stepper = page.locator("[data-stockstep]").first();
    await expect(stepper).toBeVisible();
    const key = (await stepper.getAttribute("data-stockstep"))!.split(":")[0];
    const qtyCell = page.locator(`[data-stockstep="${key}:1"]`).locator("xpath=preceding-sibling::span[1]");
    // a variant nobody counts yet shows «—»; the first + starts counting at 1
    const shown = ((await qtyCell.textContent()) || "").trim();
    const before = /^\d+$/.test(shown) ? Number(shown) : 0;

    // no confirm card: a ± is the reversible half of the rule (README § State)
    await page.locator(`[data-stockstep="${key}:1"]`).click();
    await expect(qtyCell).toHaveText(String(before + 1));
    await expect(page.getByRole("status")).toContainText(`${before + 1} шт`);

    // …and the undo really is the safety net: the shelf goes back
    await expect(page.locator(".adm-toast__undo")).toBeVisible();
    await page.locator(".adm-toast__undo").click();
    await expect(page.getByRole("status")).toContainText("Отменено");
    await expect(qtyCell).toHaveText(String(before));

    // both the change and its undo are in the journal, and only the change
    // was ever undoable
    await page.locator("[data-closetoast]").click();
    await page.locator('[data-admtab="setup"][aria-current]:visible').first().click();
    // the journal is a page of its own since the phase-3 redesign (README fix #6)
    await page.locator('[data-admsetpage="journal"]').click();
    await expect(page.getByText(/^Отмена: /).first()).toBeVisible();

    /* Leave the shelf well stocked. The first ± is what makes a variant
       *counted* in the first place, and from then on every spec that buys this
       product (admin.spec.ts, checkout.spec.ts, …) decrements the same number —
       at zero the product page swaps its «В корзину» for «нет в наличии» and
       those specs stop being able to add anything at all. Same reasoning, and
       the same 500, as sweep-admin-ops.spec.ts. */
    await page.locator('[data-admtab="goods"][aria-current]:visible').first().click();
    await page.locator('[data-admtab="stock"]:visible').last().click();
    await page.locator("[data-stockq]").fill(PRODUCT_2.id);
    await page.locator(`[data-stockedit="${key}"]`).click();
    await page.locator("[data-stockqtyinput]").fill("500");
    await page.locator("[data-stocksave]").click();
    await expect(page.getByRole("status")).toBeVisible();
  });
});
