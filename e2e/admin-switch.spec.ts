import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { adminLang, adminSection, ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * The admin's one switch — «Маркетинг → Промокоды» and everywhere else.
 *
 * Dim, 07.09.2026: «в маркетинге — промокоды — переключатель трудно понять,
 * включён он или выключен; все переключатели надо сделать проще и понятнее.»
 * The old control said its state with one cue, and that cue was which half of
 * a 44 × 26 box was filled with ink. This file holds the new one to the four
 * cues it promises — a word, the knob's side, a tick, the fill — plus the
 * things a switch owes a screen reader and a thumb.
 *
 * One component, so one spec: what passes here is what «Партнёры и баллы»,
 * «Показывать наборы», the four letters, the banner slides and «Показывать в
 * магазине» all draw (app.js `admSwitch` / `admLabelledSwitch`).
 */

/** What the eye sees, in the order the control says it. */
async function face(sw: Locator): Promise<{ checked: string | null; word: string; tick: number; knobLeft: number }> {
  const checked = await sw.getAttribute("aria-checked");
  // textContent, not innerText: the word is drawn upper-case by CSS, and what
  // matters here is the word the dictionary put there
  const word = ((await sw.locator(".adm-sw__w").textContent()) || "").trim();
  const tick = await sw.locator(".adm-sw__t i svg").count();
  const knob = await sw.locator(".adm-sw__t i").boundingBox();
  const track = await sw.locator(".adm-sw__t").boundingBox();
  return { checked, word, tick, knobLeft: Math.round((knob!.x - track!.x)) };
}

/* Every claim the control makes, checked together. `aria-checked` is waited
   for first — a promo code's switch applies after the server answers — and the
   point of these two helpers is that the other three cues then AGREE with it,
   which is the whole complaint they exist for. The knob also has to finish its
   .18 s slide before its box is read. */
async function expectOn(sw: Locator, why: string): Promise<void> {
  await expect(sw, `${why}: aria-checked`).toHaveAttribute("aria-checked", "true");
  const f = await face(sw);
  expect(f.word, `${why}: the word`).toBe("Вкл");
  expect(f.tick, `${why}: the tick in the knob`).toBe(1);
  expect(f.knobLeft, `${why}: the knob sits on the right`).toBeGreaterThan(12);
}
async function expectOff(sw: Locator, why: string): Promise<void> {
  await expect(sw, `${why}: aria-checked`).toHaveAttribute("aria-checked", "false");
  const f = await face(sw);
  expect(f.word, `${why}: the word`).toBe("Выкл");
  expect(f.tick, `${why}: no tick when off`).toBe(0);
  expect(f.knobLeft, `${why}: the knob sits on the left`).toBeLessThan(6);
}

async function marketing(page: Page): Promise<void> {
  await adminSection(page, "promos");
  await expect(page.locator("[data-admpromonew]")).toBeVisible();
}

test.describe("admin — the switch says which way it is", () => {
  /* reduced motion, so the knob is where it belongs the moment the state
     changes rather than .18 s later — the CSS turns the slide off under this
     media query, which is also what the rule asks of it. */
  test.use({ extraHTTPHeaders: ipHeaders(152), contextOptions: { reducedMotion: "reduce" } });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("a promo code's switch: word, knob, tick — and a name that does not flip", async ({ page }) => {
    await loginAsAdmin(page);
    await marketing(page);

    const code = `SW${Date.now().toString().slice(-7)}`;
    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(code);
    await page.locator('[data-promokind="percent"]').click();
    await page.locator('[data-promof="value"]').fill("10");
    await page.locator("[data-admpromosave]").click();

    const sw = page.locator(`[data-admpromotoggle="${code}"]`);
    await expect(sw).toBeVisible();

    // a new code is live, and every one of the four cues says so
    await expectOn(sw, "a fresh code");
    // …and the control is a switch, named after the code it belongs to
    await expect(sw).toHaveAttribute("role", "switch");
    await expect(sw.locator(".vh")).toHaveText(`Промокод ${code}`);

    // a thumb-sized target: the word is part of the button, not a label beside it
    const box = (await sw.boundingBox())!;
    expect(Math.round(box.height), "the switch is not a 44-px target").toBeGreaterThanOrEqual(44);
    expect(Math.round(box.width), "the word is outside the target").toBeGreaterThanOrEqual(76);

    // off — all four cues move together, and the NAME stays exactly as it was
    await sw.click();
    await expectOff(sw, "after switching the code off");
    await expect(sw.locator(".vh"), "the name flipped with the state").toHaveText(`Промокод ${code}`);

    await sw.click();
    await expectOn(sw, "and back on");
  });

  test("the same control everywhere: «Главная», «Письма», the product editor", async ({ page }) => {
    await loginAsAdmin(page);

    // «Настройки → Главная» — two switches, each with its own sentence under it
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    for (const attr of ["data-admbundles", "data-admchatbot"]) {
      const sw = page.locator(`[${attr}]`);
      await expect(sw, `${attr} is not a switch`).toHaveAttribute("role", "switch");
      const f = await face(sw);
      expect(["Вкл", "Выкл"], `${attr} shows no word`).toContain(f.word);
      // the row says what the thing IS, above the line that says what off means
      const row = page.locator(".adm-swrow", { has: page.locator(`[${attr}]`) });
      expect((await row.locator(".adm-row__sub").innerText()).trim().length,
        `${attr} has no sentence saying what off means`).toBeGreaterThan(10);
    }
    await page.locator("[data-admsetback]").click();

    // «Маркетинг → Письма» — a switch per letter, named after the letter
    await adminSection(page, "promos", "mail");
    const backstock = page.locator('[data-admflow="backstock"]');
    await expect(backstock).toHaveAttribute("role", "switch");
    await expect(backstock.locator(".vh")).toHaveText("Товар снова в наличии");

    // the product editor's boxed variant wears the same face inside its frame
    await adminSection(page, "goods");
    await page.locator("[data-admgoods]").first().click();
    const hidden = page.locator("[data-edhidden]");
    await expect(hidden).toHaveAttribute("role", "switch");
    await expect(hidden.locator(".adm-sw__w")).toHaveText("Вкл");
    await expect(hidden.locator(".adm-sw__t i svg")).toHaveCount(1);
  });

  test("keyboard and screen reader: Space flips it, and axe is happy", async ({ page }) => {
    await loginAsAdmin(page);
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();

    const sw = page.locator("[data-admchatbot]");
    const before = await sw.getAttribute("aria-checked");
    await sw.focus();
    // a focused switch is visibly focused — the outline is the panel's own
    await expect(sw).toBeFocused();
    await page.keyboard.press("Space");
    await expect(sw, "Space did not flip the switch").not.toHaveAttribute("aria-checked", before!);
    await page.keyboard.press("Space");
    await expect(sw).toHaveAttribute("aria-checked", before!);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .options({ rules: { "label-content-name-mismatch": { enabled: true } } })
      .include(".adm-list--flat")
      .analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.help}`), "axe on the switch rows").toEqual([]);
  });

  test("ET: the word is translated, the state is not lost in translation", async ({ page }) => {
    await loginAsAdmin(page);
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();

    const sw = page.locator("[data-admbundles]");
    const on = (await sw.getAttribute("aria-checked")) === "true";
    await adminLang(page, "ET");
    await expect(page.locator("[data-admbundles] .adm-sw__w")).toHaveText(on ? "Sees" : "Väljas");
    await adminLang(page, "RU");
    await expect(page.locator("[data-admbundles] .adm-sw__w")).toHaveText(on ? "Вкл" : "Выкл");
  });
});
