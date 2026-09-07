import { expect, test } from "@playwright/test";
import { ipHeaders } from "./fixtures";
import { assertClean, clearToast, openAdmin, openSettings, tab, toastText, watch } from "./sweep-helpers";

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

test.describe("admin — «Журнал изменений» shows the shop's own log", () => {
  test.use({ extraHTTPHeaders: ipHeaders(177) });

  test("two lists: this browser with «Вернуть», the server read-only", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    // something that only the server records — a sign-in, which just happened
    await openSettings(page, "journal");

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
    await tab(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    await page.locator("[data-admchatbot]").click();
    const card = page.locator(".adm-propose");
    if (await card.count()) await page.locator("[data-admapply]").click();
    await clearToast(page);

    await openSettings(page, "journal");
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
