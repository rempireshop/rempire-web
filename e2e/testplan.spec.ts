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
 *
 * And since 08.09.2026 the second thing it may not do: split. Renat reads
 * Russian, Dim reads English, and the switch in the header is a view over one
 * checklist — same item ids, same stored document. The three tests at the
 * bottom drive exactly that: that the switch really changes the language, that
 * an answer given in one is still there in the other (locally and off the
 * server), and that the Russian a tester has been using for weeks is word for
 * word what it was.
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

/** Presses one of the two language chips and waits for the list to be redrawn
    in it — the switch repaints in place, so what proves it finished is the
    verdict buttons under the first item saying the other language's word. */
async function switchTo(page: Page, lang: "ru" | "en"): Promise<void> {
  await page.locator(`[data-tp-lang="${lang}"]`).click();
  await expect(page.locator(`[data-tp-lang="${lang}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-tp-set='ok']").first()).toHaveText(lang === "ru" ? "Работает" : "Works");
}

/** The first row of the shipped plan, in both languages. Read from the route
    rather than written out here: src/data/testplan.json is replaced wholesale,
    and a spec that hardcodes a title tests the copy, not the page. */
type PlanRow = { id: string; title: string; steps: string[]; en: { title: string; steps: string[] } };

async function firstRow(page: Page): Promise<PlanRow> {
  return page.evaluate(async () => {
    const r = await fetch("/api/testplan/", { headers: { accept: "application/json" } });
    const body = (await r.json()) as { plan: { items: PlanRow[] } };
    return body.plan.items[0];
  });
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

    /* The warning is on the card and nowhere else (Dim, 08.09.2026). The list
       that used to stand at the top of the page was written for a live shop;
       this one is served from staging, where every order is a test one, so it
       warned about a danger that is not there — at the top of every visit. */
    await expect(page.locator("[data-tp-writes]")).toHaveCount(0);
    const marked = page.locator('[data-tp-item][data-writes="1"]');
    expect(await marked.count()).toBeGreaterThan(0);
    await expect(marked.first().locator(".warns")).toContainText("Создаёт настоящие данные");
    // and an item that creates nothing carries no warning at all
    const clean = page.locator('[data-tp-item][data-writes="0"]').first();
    await expect(clean.locator(".warns")).toHaveCount(0);

    const total = await page.locator("[data-tp-item]").count();
    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`).click();

    await page.locator("[data-tp-only]").click();
    await expect(page.locator(`[data-tp-item="${id}"]`)).toBeHidden();
    await expect(page.locator("[data-tp-item]:visible")).toHaveCount(total - 1);

    await page.locator("[data-tp-only]").click();
    await expect(page.locator(`[data-tp-item="${id}"]`)).toBeVisible();
  });

/** The first check that creates real data — the one carrying the warning. */
function marked1st(page: Page) {
  return page.locator('[data-tp-item][data-writes="1"]').first();
}

  test("opens in Russian and switches the whole page to English", async ({ page }) => {
    await openChecklist(page);
    const row = await firstRow(page);

    /* Russian with nothing chosen: Renat is the tester this page is for, and
       he never presses the switch at all. */
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.locator("h1")).toHaveText("Что проверяем перед запуском");
    await expect(page.locator("[data-tp-lang='ru']")).toHaveAttribute("aria-pressed", "true");
    await expect(firstItem(page).locator("h3")).toHaveText(row.title);
    await expect(page.locator("[data-tp-progress]")).toContainText("Отвечено 0 из");

    await switchTo(page, "en");

    // the page's own words
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveText("What we check before launch");
    await expect(marked1st(page).locator(".warns")).toContainText("Creates real data");
    await expect(page.locator("[data-tp-only]")).toHaveText("Unanswered only");
    await expect(page.locator("[data-tp-copy]")).toHaveText("Copy answers");
    await expect(page.locator("[data-tp-state]")).toContainText("on this device only");
    await expect(page.locator("[data-tp-progress]")).toContainText("Answered 0 of");
    // and the checklist itself, out of the plan's own `en` half
    await expect(firstItem(page).locator("h3")).toHaveText(row.en.title);
    await expect(firstItem(page).locator(".steps li").first()).toHaveText(row.en.steps[0]);
    expect(row.en.title).not.toBe(row.title);
    expect(row.en.steps.length).toBe(row.steps.length);

    /* The choice is this device's, and it survives being closed — otherwise
       Dim re-presses it every time he opens the list. */
    expect(await page.evaluate(() => localStorage.getItem("rempire-testplan-lang"))).toBe("en");
    await page.reload();
    await expect(page.locator("[data-tp-set='ok']").first()).toHaveText("Works");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("an answer given in English is still there in Russian, and the Russian is unchanged", async ({ page }) => {
    await openChecklist(page);
    const id = await firstItemId(page);

    await switchTo(page, "en");
    await page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`).click();
    await page.locator(`[data-tp-note="${id}"]`).fill("works, but the button is tiny");
    await expect.poll(async () => (await localAnswers(page))[id]?.note).toBe("works, but the button is tiny");
    await expect(page.locator("[data-tp-progress]")).toContainText("Answered 1 of");

    /* Back to Russian: same item id, same answer, and it is the Russian words
       for the verdict that appear against it now. One document, two readers. */
    await switchTo(page, "ru");
    await expect(page.locator(`[data-tp-set="ok"][data-tp-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-tp-note="${id}"]`)).toHaveValue("works, but the button is tiny");
    await expect(page.locator(`[data-tp-item="${id}"]`)).toHaveAttribute("data-status", "ok");
    await expect(page.locator(`[data-tp-by="${id}"]`)).toContainText("работает");
    await expect(page.locator("[data-tp-progress]")).toContainText("Отвечено 1 из");

    /* Word for word what Renat has been reading. These are not decoration:
       the whole point of adding English was that the Russian did not move. */
    await expect(page.locator("h1")).toHaveText("Что проверяем перед запуском");
    await expect(marked1st(page).locator(".warns")).toContainText("Создаёт настоящие данные");
    await expect(page.locator("[data-tp-only]")).toHaveText("Только без ответа");
    await expect(page.locator("[data-tp-copy]")).toHaveText("Скопировать ответы");
    await expect(page.locator("[data-tp-sync]")).toHaveText("Сохранить на сервер сейчас");
    await expect(page.locator("[data-tp-state]")).toContainText("только на этом устройстве");
    const first = firstItem(page);
    await expect(first.locator("[data-tp-set='bad']")).toHaveText("Не работает");
    await expect(first.locator("[data-tp-set='skip']")).toHaveText("Пропустить");
    await expect(first.locator(".expect b")).toHaveText("Должно получиться:");
    await expect(first.locator(".why summary")).toHaveText("Зачем это проверяем");
  });

  test("an answer given in English comes back off the server for the Russian reader", async ({ page }) => {
    await loginAsAdmin(page);
    await openChecklist(page);
    await switchTo(page, "en");

    const id = await firstItemId(page);
    await page.locator(`[data-tp-set="bad"][data-tp-id="${id}"]`).click();
    await page.locator(`[data-tp-note="${id}"]`).fill("second tap does nothing");
    await expect(page.locator("[data-tp-state]")).toContainText("Saved on the server");

    /* The device's own copy goes, so what comes back can only be the row in
       `settings` — the same row, keyed by the same id, that Renat's phone
       reads in Russian. */
    await page.evaluate(() => localStorage.removeItem("rempire-testplan-v1"));
    await page.reload();
    await expect(page.locator(`[data-tp-set="bad"][data-tp-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");

    await switchTo(page, "ru");
    await expect(page.locator(`[data-tp-note="${id}"]`)).toHaveValue("second tap does nothing");
    await expect(page.locator(`[data-tp-by="${id}"]`)).toContainText("не работает");
  });
});
