import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

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
    ["pos", "pos", "Салон"],
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

    // the list agrees, and so does the journal in «Настройки»
    await page.locator('[data-admfilter="shipped"]').click();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();
    await page.locator('[data-admtab="setup"][aria-current]:visible').first().click();
    await expect(page.getByText(`Заказ ${number}: отправлен`)).toBeVisible();
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
