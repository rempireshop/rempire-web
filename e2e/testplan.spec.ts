import { expect, test, type Page } from "@playwright/test";
import { functionalProject, ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * /test/ — the acceptance checklist Renat and Dim fill in (public/test/index.html,
 * src/app/api/testplan/route.ts).
 *
 * The one thing this page may not do is lose an answer, so that is what this
 * file drives, in both of the states it has:
 *
 *   · signed out — the answer lives in localStorage on this device and is
 *     still there after a reload, and the page says in as many words that it
 *     is only here;
 *   · signed in — the answer reaches the server, and comes back after the
 *     device's own copy has been wiped, which is the only way to prove it was
 *     the server it came from.
 *
 * Plus the handover between them: a page that collected answers with no
 * session pushes them up the moment one appears, which is exactly what
 * happens when Renat signs into the panel halfway through an evening.
 */
test.use({ extraHTTPHeaders: ipHeaders(218) });

/** The page renders from /api/testplan/, so nothing is on screen until that
    answers; every helper below waits on the same thing the tester does. */
async function openChecklist(page: Page): Promise<void> {
  await page.goto("/test/");
  await expect(page.locator("[data-tp-item]").first()).toBeVisible();
}

function firstItem(page: Page) {
  return page.locator("[data-tp-item]").first();
}

async function firstItemId(page: Page): Promise<string> {
  const id = await firstItem(page).getAttribute("data-tp-item");
  if (!id) throw new Error("/test/ rendered an item with no data-tp-item");
  return id;
}

/** The answers this device has kept for itself. */
async function localAnswers(page: Page): Promise<Record<string, { status: string; note: string }>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("rempire-testplan-v1") || "{}"));
}

test.describe("/test/ — the acceptance checklist", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
  });

  test("answers survive a reload with nobody signed in", async ({ page }) => {
    await openChecklist(page);

    // the page must say where the answers are before it is trusted with any
    await expect(page.locator("[data-tp-state]")).toContainText("только на этом устройстве");

    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`).click();
    await page.locator(`[data-tp-note="${id}"]`).fill("работает, но кнопка мелкая");

    await expect.poll(async () => (await localAnswers(page))[id]?.note).toBe("работает, но кнопка мелкая");

    await page.reload();
    await expect(page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-tp-note="${id}"]`)).toHaveValue("работает, но кнопка мелкая");
    await expect(firstItem(page)).toHaveAttribute("data-status", "ok");
    await expect(page.locator("[data-tp-progress]")).toContainText("Отвечено 1 из");
  });

  test("a signed-in answer comes back from the server, not from the device", async ({ page }) => {
    await loginAsAdmin(page);
    await openChecklist(page);
    await expect(page.locator("[data-tp-state]")).not.toContainText("только на этом устройстве");

    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="bad"][data-tp-id="${id}"]`).click();
    await page.locator(`[data-tp-note="${id}"]`).fill("не открывается со второго раза");
    await expect(page.locator("[data-tp-state]")).toContainText("Сохранено на сервере");

    /* Wipe this device's copy. Whatever is on screen after the reload can only
       have come back over the wire — which is the whole point of the row in
       `settings`: Dim reads Renat's answers without asking Renat. */
    await page.evaluate(() => localStorage.removeItem("rempire-testplan-v1"));
    await page.reload();

    await expect(page.locator(`[data-tp-set="bad"][data-tp-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-tp-note="${id}"]`)).toHaveValue("не открывается со второго раза");
    await expect(page.locator(`[data-tp-by="${id}"]`)).toContainText("не работает");
  });

  test("answers collected signed out are pushed up as soon as a session appears", async ({ page }) => {
    await openChecklist(page);
    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="skip"][data-tp-id="${id}"]`).click();
    await page.locator(`[data-tp-note="${id}"]`).fill("проверю с телефона");
    await expect.poll(async () => (await localAnswers(page))[id]?.note).toBe("проверю с телефона");

    // Renat signs into the panel halfway through, then comes back to the list
    await loginAsAdmin(page);
    await openChecklist(page);
    await expect(page.locator("[data-tp-state]")).toContainText("Сохранено на сервере");

    await page.evaluate(() => localStorage.removeItem("rempire-testplan-v1"));
    await page.reload();
    await expect(page.locator(`[data-tp-note="${id}"]`)).toHaveValue("проверю с телефона");
  });

  test("says which items create real data, and filters down to what is unanswered", async ({ page }) => {
    await openChecklist(page);

    // the standing warning, so nobody runs a real order by accident
    const danger = page.locator("[data-tp-writes]");
    await expect(danger).toBeVisible();
    await expect(danger).toContainText("создают настоящие данные");
    const marked = page.locator('[data-tp-item][data-writes="1"]');
    expect(await marked.count()).toBeGreaterThan(0);
    await expect(marked.first().locator(".warns")).toContainText("Создаёт настоящие данные");
    // every listed item is one of the marked ones
    expect(await danger.locator("li").count()).toBe(await marked.count());

    const total = await page.locator("[data-tp-item]").count();
    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`).click();

    await page.locator("[data-tp-only]").click();
    await expect(page.locator(`[data-tp-item="${id}"]`)).toBeHidden();
    await expect(page.locator("[data-tp-item]:visible")).toHaveCount(total - 1);

    await page.locator("[data-tp-only]").click();
    await expect(page.locator(`[data-tp-item="${id}"]`)).toBeVisible();
  });
});
