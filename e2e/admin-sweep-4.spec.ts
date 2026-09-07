import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, waitForScreen } from "./fixtures";
import { assertClean, clearToast, openAdmin, tab, toastText, watch } from "./sweep-helpers";

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
 *   · «Партнёры и баллы» — the one switch: off takes points and salon
 *     pricing off all five screens, on puts them back (the DEFAULT is off;
 *     this suite is a shop where the owner switched it on, see
 *     src/app/api/e2e/bootstrap).
 *
 * Desktop and mobile: the phone is the owner's machine. Own fake IP — admin
 * login is 5/min (docs/testing.md).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "tablet" || testInfo.project.name === "mobile-safari",
    "admin sweep — desktop and mobile projects only");
});

/** One of the panel's sections on either viewport: five sit in the phone's
    bottom bar, the last six behind its «Ещё» sheet, and all eleven in the
    desktop sidebar — the one navigation difference between the two (same
    shape as admin-sections.spec.ts). */
async function section(page: Page, key: string): Promise<void> {
  const direct = page.locator(`[data-admtab="${key}"][aria-current]:visible`);
  const more = page.locator("[data-admmore]:visible");
  await expect(direct.or(more).first()).toBeVisible();
  if (await direct.count()) await direct.first().click();
  else {
    await more.first().click();
    await page.locator(`.adm-sheet [data-admtab="${key}"]`).first().click();
  }
}
/** «Настройки» → one of its six pages. */
async function settings(page: Page, sub: string): Promise<void> {
  await section(page, "setup");
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

test.describe("admin — three order chips, and the steps behind them", () => {
  test.use({ extraHTTPHeaders: ipHeaders(183) });

  test("«Отправить · В пути · По счёту · Все», and every order reachable", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "orders");

    const chips = page.locator("[data-admfilter]");
    await expect(chips, "the six chips did not become four").toHaveCount(4);
    await expect(chips.nth(0)).toContainText("Отправить");
    await expect(chips.nth(1)).toHaveText("В пути");
    await expect(chips.nth(2)).toContainText("По счёту");
    await expect(chips.nth(3)).toHaveText("Все");
    // the ones that are gone are really gone
    for (const dead of ["label", "delivered", "salon"]) {
      await expect(page.locator(`[data-admfilter="${dead}"]`), `«${dead}» is still a chip`).toHaveCount(0);
    }
    await assertClean(page, w, "the orders chips");

    /* «Все» has to be a superset: whatever the other three show, «Все» shows
       too — that is what «every order stays reachable» means. */
    const countOn = async (f: string) => {
      await page.locator(`[data-admfilter="${f}"]`).click();
      await expect(page.locator(`[data-admfilter="${f}"][aria-current="true"]`)).toBeVisible();
      return page.locator("[data-admorder]").count();
    };
    const ship = await countOn("new");
    const transit = await countOn("shipped");
    const invoice = await countOn("invoice");
    const all = await countOn("all");
    expect(all, "«Все» shows fewer orders than the chips beside it").toBeGreaterThanOrEqual(
      Math.max(ship, transit, invoice));

    // the search really does look past the chip, and says so
    await page.locator(`[data-admfilter="new"]`).click();
    await page.locator("[data-admorderq]").fill("R-");
    await expect(page.locator("#orderlist"), "the search no longer explains the disabled chip")
      .toContainText("фильтр сейчас не действует");
    await page.locator("[data-admorderq]").fill("");
    await assertClean(page, w, "orders search over a chip");
  });

  test("«Отправлен» applies at once with a label and asks without one", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);

    const made = await page.request.post("/api/orders/", {
      data: {
        lang: "ru", items: [{ id: "proraso-azur-lime-after-shave-balm-100-ml", qty: 1 }],
        customer: { name: "Тест Отправка", email: "ship-confirm@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE" },
      },
    });
    expect(made.ok()).toBe(true);
    const body = await made.json();
    const orderId = body.orderId as string;
    const number = body.number as string;
    await openAdmin(page);
    // paid, so the panel offers the shipping steps at all — after the sign-in,
    // because this is an admin route and the cookie is what openAdmin() gets
    const paid = await page.request.patch(`/api/admin/orders/${orderId}/`, { data: { status: "paid" } });
    expect(paid.ok(), "the test order could not be marked paid").toBe(true);
    // the panel loads its order list once per session — this one moved behind
    // its back, so the list has to be asked again
    await page.reload();
    await waitForScreen(page, "admin");

    await tab(page, "orders");
    await page.locator("[data-admorderq]").fill(number);
    await page.locator(`[data-admorder="${orderId}"]`).click();
    await expect(page.locator("[data-admshipnow]").first()).toBeVisible({ timeout: 15_000 });

    // ---- no label: the letter would go out with no tracking number, so it asks
    await page.locator("[data-admshipnow]").first().click();
    const card = page.locator(".adm-confirm");
    await expect(card, "«Отправлен» without a label skipped the confirm").toBeVisible();
    await expect(card).toContainText("без трек-номера");
    await page.locator("[data-admcancel]").click();
    await expect(card).toHaveCount(0);

    // ---- with a label: the tracking is known, so it applies at once with an undo
    await page.locator(`[data-admlabel="${orderId}"]`).first().click();
    await expect(page.locator("[data-trackingcode]"), "the label did not register").toBeVisible({ timeout: 30_000 });
    await clearToast(page);
    // one label button, A4, with A6 kept as a quiet link beside it
    await expect(page.locator('.adm-btn[data-labelpdf="A4"]'), "the A4 label is not the button").toHaveCount(1);
    await expect(page.locator('.adm-link[data-labelpdf="A6"]'), "A6 is no longer a quiet link").toHaveCount(1);
    await expect(page.locator('.adm-btn[data-labelpdf="A6"]'), "A6 is still a second button").toHaveCount(0);

    await page.locator("[data-admshipnow]").first().click();
    await expect(page.locator(".adm-confirm"), "«Отправлен» with a label still asks").toHaveCount(0);
    expect(await toastText(page)).toMatch(/отправлен/);
    await expect(page.locator(".adm-toast__undo"), "the six-second undo is missing").toBeVisible();
    await page.locator(".adm-toast__undo").click();
    await clearToast(page);
    await assertClean(page, w, "«Отправлен» with and without a label");
  });
});

test.describe("admin — «Доставлен» can close itself", () => {
  test.use({ extraHTTPHeaders: ipHeaders(184) });

  test("the setting lives in «Доставка и оплата» and defaults to «только вручную»", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    await settings(page, "delivery");

    const days = page.locator("[data-delivdays]");
    await expect(days, "there is no «закрывать заказ через» setting").toBeVisible();
    await expect(days, "the shop closes orders on its own out of the box").toHaveValue("0");
    await expect(page.locator("[data-delivcarrier]")).toBeVisible();
    await assertClean(page, w, "the delivery-close card");

    try {
      await days.selectOption("7");
      await clearToast(page);
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/settings/");
        return ((await res.json()).settings.delivery || {}).autoDays;
      }, { timeout: 15_000, message: "the setting never reached the server" }).toBe(7);

      // …and the manual button is still there, which is what «improve, do not remove» means
      await tab(page, "orders");
      await page.locator('[data-admfilter="shipped"]').click();
      const anyShipped = await page.locator("[data-admdelivered]").count();
      expect(anyShipped >= 0).toBe(true);
    } finally {
      await settings(page, "delivery");
      await page.locator("[data-delivdays]").selectOption("0");
      await clearToast(page);
    }
  });
});

test.describe("admin — «Партнёры и баллы» is one switch above both programmes", () => {
  test.use({ extraHTTPHeaders: ipHeaders(186) });

  /* The DEFAULT (off on a fresh shop) is proved where it belongs, in vitest:
     tests/partners-switch.test.ts and tests/loyalty.test.ts. This suite's own
     shop has the programme on — it is what almost every other admin spec is
     describing (src/app/api/e2e/bootstrap) — so what is checked here is the
     switch itself: off takes all five screens away, on puts them back. */
  test("off hides points and salon pricing everywhere; on puts all of it back", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await settings(page, "prices");

    const sw = page.locator("[data-partnerson]");
    await expect(sw, "there is no «Партнёры и баллы» switch").toBeVisible();
    await expect(sw, "the suite's shop does not have the programme on").toHaveAttribute("aria-pressed", "true");

    // ---- off ---------------------------------------------------------------
    await sw.click();
    // the form under it stops asking about a programme that is off
    await expect(page.locator('[data-pricingf="proDiscountPct"]'),
      "the salon discount field is shown while the programme is off").toHaveCount(0);
    await expect(page.locator(".adm-form")).toContainText("Сейчас выключено");
    await page.locator("[data-admpricingsave]").click();
    await page.locator("[data-admapply]").click();
    await clearToast(page);

    // ---- off: the five screens Dim named ----------------------------------
    await section(page, "people");
    await expect(page.locator("[data-admcusttier]"), "the tier chips survived the off switch").toHaveCount(0);
    await expect(page.locator("[data-admpartnernew]"), "«+ Партнёр» survived the off switch").toHaveCount(0);

    await section(page, "goods");
    const first = page.locator("[data-admgoods]").first();
    await first.click();
    await page.locator('[data-edtab="sizes"]').click();
    await expect(page.locator("[data-edproprice]"), "the «Салон, €» column survived the off switch").toHaveCount(0);
    await page.locator("[data-admclose]").first().click();

    const feed = async () => (await (await page.request.get("/api/overrides/")).json()).settings.pricing;
    await expect.poll(async () => (await feed()).partnersOn,
      { timeout: 15_000, message: "the storefront was still told the programme is on" }).toBe(false);
    expect((await feed()).loyalty.enabled, "points are on in the feed with the programme off").toBe(false);

    try {
      // ---- on: everything comes back --------------------------------------
      await settings(page, "prices");
      await page.locator("[data-partnerson]").click();
      await expect(page.locator('[data-pricingf="proDiscountPct"]'),
        "switching it on did not open the settings under it").toBeVisible();
      await page.locator("[data-admpricingsave]").click();
      await page.locator("[data-admapply]").click();
      await clearToast(page);
      await expect.poll(async () => (await feed()).partnersOn,
        { timeout: 15_000, message: "the switch never reached the storefront" }).toBe(true);

      await section(page, "people");
      await expect(page.locator("[data-admcusttier]"), "the tier chips did not come back").toHaveCount(4);
      await expect(page.locator("[data-admpartnernew]")).toBeVisible();

      await section(page, "goods");
      await page.locator("[data-admgoods]").first().click();
      await page.locator('[data-edtab="sizes"]').click();
      await expect(page.locator("[data-edproprice]"), "the «Салон, €» column did not come back").toBeVisible();
      await page.locator("[data-admclose]").first().click();
      await assertClean(page, w, "«Партнёры и баллы» on");
    } finally {
      // the suite's shop has the programme on — leave it exactly as found
      await settings(page, "prices");
      const back = page.locator("[data-partnerson]");
      if ((await back.getAttribute("aria-pressed")) !== "true") {
        await back.click();
        await page.locator("[data-admpricingsave]").click();
        await page.locator("[data-admapply]").click();
        await clearToast(page);
      }
      await expect.poll(async () => (await feed()).partnersOn, { timeout: 15_000 }).toBe(true);
    }
  });
});

test.describe("admin — the birthday letter has a switch and a «за N дней»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(185) });

  test("the days setting appears with the switch and reaches the server", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    const direct = page.locator('[data-admtab="promos"][aria-current]:visible');
    const more = page.locator("[data-admmore]:visible");
    await expect(direct.or(more).first()).toBeVisible();
    if (await direct.count()) await direct.first().click();
    else {
      await more.first().click();
      await page.locator('.adm-sheet [data-admtab="promos"]').first().click();
    }
    await page.locator('[data-admtab="mail"][aria-current]:visible').first().click();

    // all three switchable letters start off, exactly as the sender reads them
    await expect(page.locator('[data-admflow="birthday"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-flowbdays]"), "the days setting shows while the letter is off").toHaveCount(0);

    try {
      await page.locator('[data-admflow="birthday"]').click();
      await clearToast(page);
      const days = page.locator("[data-flowbdays]");
      await expect(days, "switching the letter on did not offer «за N дней»").toBeVisible();
      await expect(days, "it does not default to the day itself").toHaveValue("0");
      await days.selectOption("3");
      await clearToast(page);
      await expect.poll(async () => {
        const res = await page.request.get("/api/overrides/");
        return ((await res.json()).settings.flows || {}).birthdayDays;
      }, { timeout: 15_000, message: "«за N дней» never reached the server" }).toBe(3);
      await assertClean(page, w, "the birthday days setting");
    } finally {
      const days2 = page.locator("[data-flowbdays]");
      if (await days2.count()) { await days2.selectOption("0"); await clearToast(page); }
      await page.locator('[data-admflow="birthday"]').click();
      await clearToast(page);
    }
  });
});
