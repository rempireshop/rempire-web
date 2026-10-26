import { expect, test } from "@playwright/test";
import { ipHeaders, loginAsAdmin, shopUrl } from "./fixtures";

/**
 * A product's subsection is its own (Dim, 26.10.2026): a rename moves nothing
 * — Renat's «After Shave Balm for Sensitive Skin» had taken a Proraso balm off
 * «После бритья» and failed the build — and «Без подраздела» («-») takes it off.
 * The subcollection page lists what its chip filters, the owner's changes
 * included once the shop has read them.
 */
test.describe("subsection — the product's own", () => {
  test.use({ extraHTTPHeaders: ipHeaders(229) });

  test("a rename keeps the product on «После бритья»; «Без подраздела» takes it off", async ({ page, browser }, info) => {
    test.skip(info.project.name !== "desktop", "one write per action is enough — desktop runs it");
    test.setTimeout(120_000);
    const id = "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml";
    await loginAsAdmin(page);
    const put = (data: Record<string, unknown>) => page.request.put("/api/admin/overrides/", { data: { id, ...data } });
    const card = (shop: import("@playwright/test").Page) => shop.locator(`.grid a.card__go[data-go-product="${id}"]`);
    try {
      expect((await put({ name: "Sensitive Skin" })).ok()).toBe(true);
      const shop = await browser.newPage();
      await shop.goto(shopUrl("", "/c/beard/af/"));
      // the shop has read the override when the card carries the new name — and it is still here
      await expect(card(shop)).toContainText("Sensitive Skin", { timeout: 20_000 });

      expect((await put({ subcat: "-" })).ok()).toBe(true);
      await shop.goto(shopUrl("", "/c/beard/") + "?r=1");
      await shop.goto(shopUrl("", "/c/beard/af/"));
      await expect(card(shop), "«Без подраздела» left the balm on «После бритья»").toHaveCount(0, { timeout: 20_000 });
      await shop.close();
    } finally {
      await put({ name: null, subcat: null });
    }
  });
});
