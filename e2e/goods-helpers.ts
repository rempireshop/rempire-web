import { expect, type Locator, type Page } from "@playwright/test";
import { tab } from "./sweep-helpers";

/**
 * The product card of direction 1a (design_handoff_admin_ux README § 5): one
 * page, no «Сохранить». A box saves itself when it is LEFT (a price, a size's
 * name, a code, a count) or a second after the last keystroke (the texts),
 * and a switch or a photo button at once — each through the route it always
 * used, with «Сохраняем… → Сохранено ✓» in the panel's one save status
 * ([data-admsavest], app.js admSaveStatusHTML).
 *
 * These are the few moves every goods spec makes with it.
 */

/** Opens a product's card from «Товары → Каталог», by its id. */
export async function openCard(page: Page, id: string): Promise<void> {
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await expect(page.locator(`[data-edfor="${id}"]`)).toBeVisible();
}

/** Whatever the card owes has gone and been answered — the status is not
    «Сохраняем…», and it is not «Не сохранилось». */
export async function settled(page: Page, what = "the save"): Promise<void> {
  const st = page.locator("[data-admsavest]").first();
  await expect.poll(async () => st.getAttribute("data-st"), { timeout: 20_000, message: `${what} is still in the air` })
    .not.toBe("saving");
  expect(await st.getAttribute("data-st"), `${what} did not land`).not.toBe("error");
}

/** Types into a box and leaves it — which is what saves it — then waits for the answer. */
export async function typeAndLeave(page: Page, box: Locator, value: string): Promise<void> {
  await box.fill(value);
  await box.blur();
  await settled(page);
}

/** «← Товары»: the page's link on a desktop, the top bar's on a phone. */
export async function closeCard(page: Page): Promise<void> {
  const link = page.locator(".adm-ed__back:visible");
  if (await link.count()) await link.first().click();
  else await page.locator("[data-admtopback]:visible").first().click();
}

/** A section of the card, brought on screen (the old tab keys still name them). */
export async function toSection(page: Page, key: "shop" | "what" | "sizes" | "photos" | "bysize" | "video" | "desc" | "seo"): Promise<void> {
  const sec = page.locator(`[data-edsec="${key}"]`);
  await sec.scrollIntoViewIfNeeded();
  if (key === "seo") {
    const fold = sec.locator("[data-admfold]");
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
  }
}
