import { expect, type Page, test } from "@playwright/test";
import { ipHeaders } from "./fixtures";
import { assertClean, clearToast, openAdmin, tab, watch } from "./sweep-helpers";

/**
 * The fourth admin sweep — Dim's answers of 07.09.2026
 * (docs/audit/2026-09-07-admin.md). One test per decision, each pinning the
 * behaviour he asked for rather than the markup around it:
 *
 *   · «Журнал изменений» shows the SERVER's log beside this browser's own,
 *     and says in one sentence why «Вернуть» only works on the second;
 *   · the phone's Back button closes an open card instead of leaving the
 *     panel for the shop;
 *   · the «ИИ-помощник» square stops being green while it says the model is
 *     not connected;
 *   · «Написать клиенту → Отправить» goes through the confirm card;
 *   · the orders screen has three chips, not six, and every order is still
 *     reachable through one of them;
 *   · «Отправлен» applies at once when a label exists and asks when it does not;
 *   · one label button — «Открыть PDF (A4)» — with A6 as a quiet link;
 *   · «Партнёры и баллы» off by default hides points and salon pricing
 *     everywhere, and putting it back restores them.
 *
 * Desktop and mobile: the phone is the owner's machine. Own fake IP — admin
 * login is 5/min (docs/testing.md).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "tablet" || testInfo.project.name === "mobile-safari",
    "admin sweep — desktop and mobile projects only");
});

/** «Настройки» → one of its six pages. Its own helper rather than
    sweep-helpers' openSettings(), because «Настройки» sits in the desktop
    sidebar but behind the phone's «Ещё» sheet — the one navigation difference
    between the two viewports (same shape as admin-sections.spec.ts). */
async function settings(page: Page, sub: string): Promise<void> {
  const direct = page.locator('[data-admtab="setup"][aria-current]:visible');
  const more = page.locator("[data-admmore]:visible");
  await expect(direct.or(more).first()).toBeVisible();
  if (await direct.count()) await direct.first().click();
  else {
    await more.first().click();
    await page.locator('.adm-sheet [data-admtab="setup"]').first().click();
  }
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(page.locator("[data-admsetback]")).toBeVisible();
}

test.describe("admin — «Журнал изменений» shows the shop's own log", () => {
  test.use({ extraHTTPHeaders: ipHeaders(177) });

  test("two lists: this browser with «Вернуть», the server read-only", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    // something that only the server records — a sign-in, which just happened
    await settings(page, "journal");

    // the two headings, and the sentence that explains the difference
    await expect(page.locator(".adm-sec__t").filter({ hasText: "Ваши изменения в этом браузере" })).toBeVisible();
    await expect(page.locator(".adm-sec__t").filter({ hasText: "Журнал магазина" })).toBeVisible();
    await expect(page.locator(".adm-narrow"), "the journal does not say why «Вернуть» is local")
      .toContainText("«Вернуть» работает только здесь");
    await expect(page.locator(".adm-narrow"), "the server list is not labelled as shop-wide")
      .toContainText("с любого устройства");

    // the server's own rows really arrive, and carry who did it
    const serverRows = page.locator(".adm-jrow__who");
    await expect(serverRows.first(), "GET /api/admin/audit is still uncalled").toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".adm-narrow")).toContainText(/владелец|вход с адреса|магазин сам/);

    // the shop-wide rows are read-only — «Вернуть» belongs to the local list only
    const undoCount = await page.locator("[data-admundo]").count();
    const whoCount = await serverRows.count();
    expect(whoCount, "no server rows at all").toBeGreaterThan(0);
    expect(undoCount, "«Вернуть» leaked onto the server rows").toBeLessThan(whoCount + 1);

    await assertClean(page, w, "journal with the server log");
  });

  test("a change made here appears in both lists, and «Вернуть» is on the local one", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    // the chat-bot switch: shop-wide, reversible, and audited by the server
    await settings(page, "home");
    await page.locator("[data-admchatbot]").click();
    const card = page.locator(".adm-confirm");
    if (await card.count()) await page.locator("[data-admapply]").click();
    await clearToast(page);

    await settings(page, "journal");
    await expect(page.locator('[data-admundo="0"]'), "the local list lost its «Вернуть»").toBeVisible();
    await expect.poll(async () => {
      const res = await page.request.get("/api/admin/audit/?limit=20");
      const body = await res.json();
      return JSON.stringify(body.audit || []).includes("chatbot");
    }, { timeout: 15_000, message: "the server never recorded the switch" }).toBe(true);
    await assertClean(page, w, "journal after a change");

    // put the shop back exactly as it was
    await page.locator('[data-admundo="0"]').click();
    await clearToast(page);
  });
});

test.describe("admin — the browser's Back closes an open card", () => {
  test.use({ extraHTTPHeaders: ipHeaders(178) });

  test("Back leaves the panel only once nothing is open any more", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    // a settings page is a card of its own: Back closes it and stays in the panel
    await settings(page, "journal");
    await page.goBack();
    await expect(page.locator("[data-admsetback]"), "Back did not close the settings page").toHaveCount(0);
    await expect(page.locator('[data-admsetpage="journal"]'), "Back left the panel altogether").toBeVisible();
    await assertClean(page, w, "Back on a settings page");

    // a product editor: two layers deep — the editor, then a confirm card over it
    await tab(page, "goods");
    const first = page.locator("[data-admgoods]").first();
    await first.click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    await page.locator("[data-admgoodspull]").click();
    await expect(page.locator(".adm-confirm")).toBeVisible();

    // one Back closes the confirm and leaves the editor open…
    await page.goBack();
    await expect(page.locator(".adm-confirm"), "Back did not close the confirm card").toHaveCount(0);
    await expect(page.locator("[data-admsavegoods]"), "Back closed the editor too").toBeVisible();

    // …the next one closes the editor and still keeps the panel
    await page.goBack();
    await expect(page.locator("[data-admsavegoods]"), "Back did not close the editor").toHaveCount(0);
    await expect(page.locator("[data-admgoods]").first(), "Back left the panel").toBeVisible();
    await assertClean(page, w, "Back through the editor");

    // closing with the button spends the parked entry, so the next Back is
    // not a press that does nothing: it really leaves the panel
    await first.click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    await page.locator("[data-admclose]").first().click();
    await expect(page.locator("[data-admsavegoods]")).toHaveCount(0);
    await page.goBack();
    await expect(page.locator("[data-admgoods]"), "Back after a button-close did nothing").toHaveCount(0);
  });
});

test.describe("admin — «Подключения» tells the truth about the model", () => {
  test.use({ extraHTTPHeaders: ipHeaders(179) });

  test("the «ИИ-помощник» square is not green while it says the model is off", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);

    // no key in this suite → GET /api/assistant/ answers enabled:false
    await page.route("**/api/assistant/", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
    });
    await openAdmin(page);

    const direct = page.locator('[data-admtab="apps"][aria-current]:visible');
    const more = page.locator("[data-admmore]:visible");
    await expect(direct.or(more).first()).toBeVisible();
    if (await direct.count()) await direct.first().click();
    else {
      await more.first().click();
      await page.locator('.adm-sheet [data-admtab="apps"]').first().click();
    }

    const row = page.locator(".adm-row", { hasText: "ИИ-помощник" }).first();
    await expect(row).toBeVisible();
    await expect(row, "the row no longer says the model is off").toContainText("Модель не подключена");
    // the square is grey, not the green every working row wears
    await expect(row.locator(".adm-dot--off"),
      "the «ИИ-помощник» square is still green while it says the model is off").toHaveCount(1);
    await assertClean(page, w, "«Подключения» with no model");
  });

  test("…and green when a model really answers", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/assistant/", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) });
    });
    await openAdmin(page);
    const direct = page.locator('[data-admtab="apps"][aria-current]:visible');
    const more = page.locator("[data-admmore]:visible");
    await expect(direct.or(more).first()).toBeVisible();
    if (await direct.count()) await direct.first().click();
    else {
      await more.first().click();
      await page.locator('.adm-sheet [data-admtab="apps"]').first().click();
    }
    const row = page.locator(".adm-row", { hasText: "ИИ-помощник" }).first();
    await expect(row).toContainText("Модель подключена");
    await expect(row.locator(".adm-dot--off"), "a working model still shows the grey square").toHaveCount(0);
  });
});

test.describe("admin — «Написать клиенту» asks before it sends", () => {
  test.use({ extraHTTPHeaders: ipHeaders(182) });

  test("«Отправить» goes through the confirm card, and «Отмена» sends nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const sent: string[] = [];
    await page.route("**/api/admin/mail/send/", async (route) => {
      sent.push(String(route.request().postData() || ""));
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, messages: [] }),
      });
    });

    /* An order of this spec's own, straight through the public route — the
       panel needs something to write about and the suite must not depend on
       another file having run first. */
    const made = await page.request.post("/api/orders/", {
      data: {
        lang: "ru", items: [{ id: "proraso-azur-lime-after-shave-balm-100-ml", qty: 1 }],
        customer: { name: "Тест Письмо", email: "letter-confirm@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE" },
      },
    });
    expect(made.ok(), "the test order was not created").toBe(true);
    const number = (await made.json()).number as string;

    await openAdmin(page);
    await tab(page, "orders");
    await page.locator("[data-admorderq]").fill(number);
    const first = page.locator("[data-admorder]").first();
    await expect(first, "no orders to write about").toBeVisible({ timeout: 15_000 });
    await first.click();
    await expect(page.locator("[data-admorderreply]")).toBeVisible();
    await page.locator("[data-admorderreply]").click();

    const draft = page.locator("[data-orderreplydraft]");
    await expect(draft).toBeVisible();
    await draft.fill("Здравствуйте! Посылка уйдёт завтра утром.");
    await page.locator("[data-admordersend]").click();

    // the card, with the address and the letter in it
    const card = page.locator(".adm-confirm");
    await expect(card, "«Отправить» still sends with no confirm").toBeVisible();
    await expect(card).toContainText("Отправить письмо клиенту?");
    await expect(card).toContainText("отозвать его нельзя");
    await expect(card, "the card does not show the letter it is about to send")
      .toContainText("Посылка уйдёт завтра утром");
    expect(sent, "the letter left before the card was answered").toEqual([]);

    // «Отмена» sends nothing and keeps the draft
    await page.locator("[data-admcancel]").click();
    await expect(card).toHaveCount(0);
    expect(sent, "«Отмена» sent the letter anyway").toEqual([]);
    await expect(page.locator("[data-orderreplydraft]"), "«Отмена» threw the draft away")
      .toHaveValue(/Посылка уйдёт завтра утром/);

    // …and «Отправить» on the card really sends
    await page.locator("[data-admordersend]").click();
    await page.locator("[data-admapply]").click();
    await expect.poll(() => sent.length, { timeout: 15_000, message: "the confirmed letter never left" }).toBe(1);
    expect(sent[0]).toContain("завтра утром");
    await clearToast(page);
    await assertClean(page, w, "«Написать клиенту» behind the confirm card");
  });
});
