import { expect, type Page, test } from "@playwright/test";
import { adminSection, ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * The menu makes room for the assistant (Dim, 26.09.2026).
 *
 * On a laptop-size window the open assistant (a 380-px column on the right)
 * and the open menu (232 px on the left) left the work a narrow column. Now,
 * when the assistant opens on a window under 1200 px, an open menu folds to
 * its icons by itself (68 px) and comes back when the assistant closes. Wider
 * windows do not change. The fold is not the owner's preference: the stored
 * `nav` (rempire-admin-panes, admPanesSave) stays what he chose; and a press
 * of the fold button while the assistant is open is his choice — the close
 * then restores nothing. The decision logic itself is unit-tested in
 * tests/admin-assistant-navfold.test.ts; this file proves it in the browser.
 *
 * Desktop project only, at its own window sizes: a phone has no side menu,
 * and the desktop project's own 1280 is on the «nothing changes» side.
 * Every describe has its own fake IP: admin login is rate-limited 5/min.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the side menu is the desktop's");
});

/** The sidebar's width once its .2 s transition settles — polled, because
    every render rebuilds the node and a probe landing mid-measure detaches it. */
async function sideWidth(page: Page): Promise<number> {
  const box = await page.locator(".adm-side").boundingBox();
  return box ? Math.round(box.width) : 0;
}
/** What this device keeps for the panel's panes. */
async function stored(page: Page): Promise<{ nav?: boolean; ai?: boolean } | null> {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("rempire-admin-panes") || "null"); } catch { return null; }
  });
}
const foldBtn = (page: Page) => page.locator("[data-admnav]");
const opener = (page: Page) => page.locator(".adm-aiopen:visible");
const pane = (page: Page) => page.locator(".adm-asst");

async function openAssistant(page: Page): Promise<void> {
  await expect(opener(page)).toHaveCount(1);
  await opener(page).click();
  await expect(pane(page)).toBeVisible();
}
async function closeAssistant(page: Page): Promise<void> {
  await pane(page).locator(".adm-asst__fold").click();
  await expect(pane(page)).toHaveCount(0);
}
async function expectMenu(page: Page, open: boolean, why: string): Promise<void> {
  await expect(foldBtn(page), why).toHaveAttribute("aria-expanded", String(open));
  await expect(foldBtn(page)).toHaveAttribute("aria-label", open ? "Свернуть меню" : "Развернуть меню");
  await expect.poll(() => sideWidth(page), { message: why }).toBe(open ? 232 : 68);
}

test.describe("a laptop-size window, 1100 px", () => {
  test.use({ viewport: { width: 1100, height: 800 }, extraHTTPHeaders: ipHeaders(247) });

  test("the assistant folds the menu as it opens and gives it back as it closes; the preference is untouched", async ({ page }) => {
    await loginAsAdmin(page);
    await adminSection(page, "orders");
    await expectMenu(page, true, "the menu starts open");

    await openAssistant(page);
    await expectMenu(page, false, "the menu did not fold for the assistant");
    await expect(page.locator(".adm2")).toHaveClass(/adm2--navmin/);
    // the icons are still there to click: the section changes, the fold stays
    await page.locator('.adm-side [data-admtab="goods"]').click();
    await expect(page.locator('.adm-side [data-admtab="goods"]')).toHaveAttribute("aria-current", "true");
    await expectMenu(page, false, "changing section unfolded the menu under the open assistant");
    expect(await stored(page), "the automatic fold was stored as the owner's preference").toMatchObject({ nav: true, ai: true });

    await closeAssistant(page);
    await expectMenu(page, true, "the menu stayed folded after the assistant closed");
    expect(await stored(page)).toMatchObject({ nav: true, ai: false });
  });

  test("unfolding by hand while the assistant is open is kept after it closes", async ({ page }) => {
    await loginAsAdmin(page);
    await openAssistant(page);
    await expectMenu(page, false, "the menu did not fold for the assistant");

    await foldBtn(page).click();                     // «Развернуть меню»
    await expectMenu(page, true, "one press did not unfold the automatically folded menu");
    await expect(pane(page), "the fold button closed the assistant").toBeVisible();
    expect(await stored(page)).toMatchObject({ nav: true, ai: true });

    await closeAssistant(page);
    await expectMenu(page, true, "the owner's own unfold was undone by the close");
    expect(await stored(page)).toMatchObject({ nav: true, ai: false });
  });

  test("folding it again by hand is his fold: the close does not unfold it", async ({ page }) => {
    await loginAsAdmin(page);
    await openAssistant(page);
    await foldBtn(page).click();                     // unfold…
    await expectMenu(page, true, "one press did not unfold the automatically folded menu");
    await foldBtn(page).click();                     // …and fold, himself
    await expectMenu(page, false, "the second press did not fold");
    expect(await stored(page), "the owner's own fold was not remembered").toMatchObject({ nav: false });

    await closeAssistant(page);
    await expectMenu(page, false, "closing the assistant undid a fold the owner made himself");
    expect(await stored(page)).toMatchObject({ nav: false, ai: false });
  });
});

test.describe("a wide window, a resize, a reload", () => {
  test.use({ extraHTTPHeaders: ipHeaders(248) });

  test("1300 px: the menu does not move when the assistant opens or closes", async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 });
    await loginAsAdmin(page);
    await expectMenu(page, true, "the menu starts open");

    await openAssistant(page);
    await expectMenu(page, true, "the menu folded on a wide window");
    await closeAssistant(page);
    await expectMenu(page, true, "the menu moved on a wide window");
    expect(await stored(page)).toMatchObject({ nav: true, ai: false });
  });

  test("a resize while the assistant is open neither folds nor unfolds", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await loginAsAdmin(page);
    await openAssistant(page);
    await expectMenu(page, false, "the menu did not fold for the assistant");

    await page.setViewportSize({ width: 1400, height: 800 });
    await expectMenu(page, false, "widening the window unfolded the menu under the open assistant");
    await closeAssistant(page);
    await expectMenu(page, true, "the menu stayed folded after the assistant closed");

    // …and the other way: opened wide, then narrowed
    await openAssistant(page);
    await expectMenu(page, true, "the menu folded on a wide window");
    await page.setViewportSize({ width: 1100, height: 800 });
    await expectMenu(page, true, "narrowing the window folded the menu under the open assistant");
    await closeAssistant(page);
    await expectMenu(page, true, "the menu moved when the assistant closed");
  });

  test("1100 px: a reload with the assistant open draws the fold again, and the close still gives the menu back", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await loginAsAdmin(page);
    await openAssistant(page);
    await expectMenu(page, false, "the menu did not fold for the assistant");

    await page.reload();
    await expect(pane(page), "the open assistant is remembered on this device").toBeVisible({ timeout: 20_000 });
    await expectMenu(page, false, "the reopened assistant did not fold the menu");
    expect(await stored(page), "the reload found the fold stored as a preference").toMatchObject({ nav: true, ai: true });

    await closeAssistant(page);
    await expectMenu(page, true, "the reload left the menu folded for good");
    expect(await stored(page)).toMatchObject({ nav: true, ai: false });
  });
});
