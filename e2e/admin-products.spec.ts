import { expect, type Browser, type Page, test } from "@playwright/test";
import { eur, ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * «+ Товар» — product creation (db/migrations/131_custom_products.sql,
 * src/lib/custom-products.ts, the goods editor's «new» mode in app.js).
 *
 * What is pinned, end to end, because it is what the owner is actually doing:
 *   · the editor refuses an empty brand and a bad price OUT LOUD, next to the box;
 *   · «Сохранить товар» makes a row, opens the product on «Фото и видео» and
 *     the list shows it first with «новый»;
 *   · a photo uploaded there (the upload route is stubbed — no bucket in this
 *     suite) is the product's photo in the shop, and «Убрать фон» replaces it
 *     in the draft when the server says it can;
 *   · the product is in the shop in all three languages — its page, its
 *     category, search, the brand page, the cart and the checkout summary —
 *     and the price the checkout quotes is the row's;
 *   · a price change reaches the shop; «Снять с продажи» goes through the
 *     confirm card, the toast's undo puts it back, and hidden it really vanishes;
 *   · the assistant's create_product (the model stubbed at the network edge)
 *     lands in the same editor, on the same tab, as a real row.
 *
 * Everything this spec makes is taken off sale at the end, so the specs that
 * count the catalogue never see it.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "product creation — desktop project only, see docs/testing.md");
});

/** A 1×1 PNG — the upload route is stubbed, so only the picker's contract matters. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PHOTO_URL = "/shop/img/system-4-bio-botanical-shampoo-0.webp?v=5";
const CUTOUT_URL = "/shop/img/system-4-bio-botanical-serum-0.webp?v=5";

/** No bucket in this suite (playwright.config.ts) — the media routes answer from here. */
async function stubMedia(page: Page, opts: { cutout: boolean }): Promise<string[]> {
  const uploads: string[] = [];
  await page.route("**/api/admin/upload/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, configured: true, cutout: opts.cutout, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
      return;
    }
    if (req.method() === "DELETE") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (url.includes("/cutout/")) {
      const body = req.postDataJSON() as { url?: string; key?: string };
      uploads.push(`cutout:${body.url || body.key}`);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, key: "products/e2e/1-e2e-cutout.png", url: CUTOUT_URL, thumbUrl: CUTOUT_URL, bytes: 10 }) });
      return;
    }
    uploads.push("upload");
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, key: "products/e2e/1-e2e.webp", url: PHOTO_URL, thumbUrl: PHOTO_URL, width: 1, height: 1, bytes: 10, alt: "" }) });
  });
  return uploads;
}

type EdTab = "main" | "sizes" | "media" | "desc" | "seo";
async function edTab(page: Page, key: EdTab): Promise<void> {
  await page.locator(`[data-edtab="${key}"]`).click();
  await expect(page.locator(`[data-edtab="${key}"][aria-current="true"]`)).toBeVisible();
}
async function openEditor(page: Page, id: string): Promise<void> {
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await expect(page.locator(`[data-admsavegoods="${id}"]`)).toBeVisible();
}

async function customRow(page: Page, id: string): Promise<{ active: boolean; price: number; gallery?: string[] } | null> {
  const res = await page.request.get("/api/admin/products/");
  const list = (await res.json()).products as Array<{ id: string; active: boolean; price: number; gallery?: string[] }>;
  return list.find((p) => p.id === id) ?? null;
}
async function feedHas(page: Page, id: string): Promise<boolean> {
  const res = await page.request.get("/api/overrides/");
  const custom = ((await res.json()).custom || []) as Array<{ id: string }>;
  return custom.some((p) => p.id === id);
}

/** The product in a fresh, logged-out storefront — its page, category, search, brand, cart, checkout. */
async function seeInShop(browser: Browser, id: string, opts: { brand: string; brandSlug: string; name: string; price: number; photo: string }) {
  for (const lang of LANGS) {
    const shop = await freshShop(browser);
    const p = shop.page;
    // the product page — a direct visit, nothing in this browser knows the id yet
    await p.goto(shopUrl(lang.seg, `/p/${id}/`));
    await waitForScreen(p, "product");
    await expect(p.locator("[data-price]")).toHaveText(eur(opts.price, lang.code));
    await expect(p.locator(".pdp")).toContainText(opts.brand);
    expect(await p.locator(".pdp__img").getAttribute("style"), `${lang.code}: the product page shows another photo`).toContain(opts.photo);
    // …into the cart, and the checkout quotes the same price
    await p.locator(`.pdp__add[data-add="${id}"]`).click();
    await expect(p.getByRole("status")).toBeVisible();
    await p.goto(shopUrl(lang.seg, "/checkout/"));
    await waitForScreen(p, "checkout");
    await expect(p.locator(".cosum__pr").first()).toHaveText(eur(opts.price, lang.code));
    await expect(p.locator(".cosum__nm").first()).toContainText(opts.name.slice(0, 12));
    // the category, newest first
    await p.goto(shopUrl(lang.seg, "/c/beard/"));
    await waitForScreen(p, "catalog");
    await p.locator("[data-sort]").selectOption("new");
    await expect(p.locator(`.card__go[data-go-product="${id}"]`), `${lang.code}: not in its category`).toBeVisible();
    // search
    await p.goto(shopUrl(lang.seg, `/search/?q=${encodeURIComponent(opts.name.split(" ")[0])}`));
    await waitForScreen(p, "search");
    await expect(p.locator(`.card__go[data-go-product="${id}"]`), `${lang.code}: not found by search`).toBeVisible();
    // the brand page of a brand the catalogue never had
    await p.goto(shopUrl(lang.seg, `/b/${opts.brandSlug}/`));
    await waitForScreen(p, "catalog");
    await expect(p.locator(`.card__go[data-go-product="${id}"]`), `${lang.code}: not on its brand page`).toBeVisible();
    await assertClean(p, shop.w, `storefront ${lang.code}`);
    await shop.close();
  }
}

test.describe("admin — product creation", () => {
  test.use({ extraHTTPHeaders: ipHeaders(173) });

  test("«+ Товар»: refuses out loud, creates, takes a photo, is in the shop, changes price, hides with undo", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const BRAND = `E2E Brand ${stamp}`;
    const NAME = `Balm ${stamp} — бальзам для бороды`;
    const uploads = await stubMedia(page, { cutout: true });
    let id = "";

    await openAdmin(page);
    await tab(page, "goods");
    await expect(page.locator("[data-admgoodsnew]"), "«+ Товар» is not offered").toBeEnabled();
    await page.locator("[data-admgoodsnew]").click();
    await expect(page.locator(".adm-head__kicker")).toHaveText("Новый товар");
    await expect(page.locator("[data-edbrand]")).toBeVisible();
    // no photo button before there is a product to file it under
    await edTab(page, "media");
    await expect(page.locator("[data-galwait]")).toBeVisible();
    await expect(page.locator("[data-galup]")).toHaveCount(0);
    await edTab(page, "main");

    try {
      // ---- refused out loud, next to the box ------------------------------
      await page.locator('[data-admsavegoods="new"]').click();
      await expect(page.locator("[data-goodserr]")).toContainText("Впишите бренд");
      await expect(page.locator("[data-edbrand]")).toBeFocused();
      await page.locator("[data-edbrand]").fill(BRAND);
      await page.locator('[data-admsavegoods="new"]').click();
      await expect(page.locator("[data-goodserr]")).toContainText("Впишите название");
      await page.locator("[data-edname]").fill(NAME);
      await page.locator("[data-edcat]").selectOption("beard");
      // the subsection list follows the section
      await expect(page.locator("[data-edsubcat] option")).toHaveCount(5);
      await page.locator("[data-edsubcat]").selectOption("ba");
      await page.locator('[data-admsavegoods="new"]').click();
      await expect(page.locator("[data-goodserr]")).toContainText("Цена — число");
      await edTab(page, "sizes");
      await page.locator("[data-edprice]").fill("abc");
      await page.locator('[data-admsavegoods="new"]').click();
      await expect(page.locator("[data-goodserr]")).toContainText("Цена — число");
      await expect(page.locator("[data-edprice]")).toBeFocused();
      await page.locator("[data-edprice]").fill("14,90");
      // the brand the owner typed on «Основное» is still there after all that
      await edTab(page, "main");
      expect(await page.locator("[data-edbrand]").inputValue()).toBe(BRAND);
      await assertClean(page, w, "the new-product form");

      // ---- saved: a row, the editor on «Фото и видео», «новый» in the list --
      await page.locator('[data-admsavegoods="new"]').click();
      expect(await toastText(page)).toMatch(/Товар создан/);
      await clearToast(page);
      await expect(page.locator('[data-edtab="media"][aria-current="true"]')).toBeVisible();
      id = (await page.locator("[data-admsavegoods]").getAttribute("data-admsavegoods")) || "";
      expect(id, "the editor did not reopen on the created product").toMatch(/^c-e2e-brand-/);
      await expect(page.locator(".adm-head__kicker")).toContainText("ваш товар");
      expect(await customRow(page, id)).toMatchObject({ active: true, price: 14.9 });
      expect(await feedHas(page, id), "the public feed does not carry the new product").toBe(true);

      // ---- a photo, and «Убрать фон» when the server offers it -------------
      await expect(page.locator(`[data-galup="${id}"]`)).toBeEnabled();
      await page.locator(`[data-galfile="${id}"]`).setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: PNG });
      await expect(page.locator(".adm-photo:not(.adm-photo--add)")).toHaveCount(1);
      expect(uploads).toContain("upload");
      await expect(page.locator('[data-galcut="0"]'), "no «Убрать фон» although the server offers it").toBeVisible();
      await page.locator('[data-galcut="0"]').click();
      expect(await toastText(page)).toMatch(/Фон убран/);
      await clearToast(page);
      expect(uploads.some((u) => u.startsWith("cutout:") && u.includes(PHOTO_URL))).toBe(true);
      expect(await page.locator(".adm-photo__img").first().getAttribute("style")).toContain(CUTOUT_URL);
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.gallery?.[0], { timeout: 15_000 }).toBe(CUTOUT_URL);
      await assertClean(page, w, "photo saved");

      // the list: first, with «новый»
      await tab(page, "goods");
      await page.locator("[data-goodsq]").fill("");
      await expect(page.locator("[data-admgoods]").first()).toHaveAttribute("data-admgoods", id);
      await expect(page.locator(`[data-admgoods="${id}"] [data-goodsfresh]`)).toHaveText("новый");

      // ---- the shop, in three languages ---------------------------------------
      await seeInShop(browser, id, { brand: BRAND, brandSlug: `e2e-brand-${stamp}`, name: NAME, price: 14.9, photo: CUTOUT_URL });

      // ---- the price changes on the row, and the shop follows ------------------
      await openEditor(page, id);
      await edTab(page, "sizes");
      await page.locator("[data-edprice]").fill("19");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.price, { timeout: 15_000 }).toBe(19);
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page.locator("[data-price]")).toHaveText(eur(19, "RU"));
      await assertClean(shop.page, shop.w, "product page after the price change");
      await shop.close();
      // …and the checkout charges the row's price, not the browser's
      const priced = await page.request.post("/api/orders/", {
        data: { lang: "RU", items: [{ id, qty: 2 }], customer: { name: "E2E", email: "e2e-products@example.com", phone: "+372 5555 5555" },
          shipping: { method: "parcel", country: "EE", pointId: "1234", pointName: "Kristiine keskus" } },
        headers: ipHeaders(174),
      });
      expect(priced.status(), "the checkout refused the custom product").toBe(201);

      // ---- «Снять с продажи»: the card, the undo, and the vanishing -------------
      await openEditor(page, id);
      await page.locator("[data-admgoodspull]").click();
      const card = page.locator(".adm-confirm");
      await expect(card).toContainText("Снять с продажи?");
      await expect(card).toContainText("исчезнет из магазина");
      await page.locator("[data-admcancel]").click();
      await expect(card).toHaveCount(0);
      await page.locator("[data-admgoodspull]").click();
      await page.locator("[data-admapply]").click();
      expect(await toastText(page)).toMatch(/Снято с продажи/);
      await expect.poll(async () => (await customRow(page, id))?.active, { timeout: 15_000 }).toBe(false);
      await page.locator(".adm-toast__undo").click();
      await expect(page.getByRole("status")).toContainText("Отменено");
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.active, { timeout: 15_000 }).toBe(true);
      expect(await feedHas(page, id)).toBe(true);

      await openEditor(page, id);
      await page.locator("[data-admgoodspull]").click();
      await page.locator("[data-admapply]").click();
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.active, { timeout: 15_000 }).toBe(false);
      expect(await feedHas(page, id), "a hidden product is still in the public feed").toBe(false);
      await expect(page.locator(`[data-admgoods="${id}"]`)).toContainText("Скрыт");
      await assertClean(page, w, "hidden");

      const gone = await freshShop(browser);
      await gone.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(gone.page, "home");
      await gone.page.goto(shopUrl("", `/search/?q=${encodeURIComponent(NAME.split(" ")[0])}`));
      await waitForScreen(gone.page, "search");
      await expect(gone.page.locator(`.card__go[data-go-product="${id}"]`)).toHaveCount(0);
      await gone.close();
      const refused = await page.request.post("/api/orders/", {
        data: { lang: "RU", items: [{ id, qty: 1 }], customer: { name: "E2E", email: "e2e-products@example.com", phone: "+372 5555 5555" },
          shipping: { method: "parcel", country: "EE", pointId: "1234", pointName: "Kristiine keskus" } },
        headers: ipHeaders(174),
      });
      expect(refused.status()).toBe(400);
      expect((await refused.json()).error).toBe("out_of_stock");

      // …and «Вернуть в продажу» from the hidden product's own page works too
      await openEditor(page, id);
      await page.locator(`[data-admgoodsshow="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Снова в продаже/);
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.active, { timeout: 15_000 }).toBe(true);
    } finally {
      if (id) await page.request.delete(`/api/admin/products/${id}/`);
    }
  });

  test("the assistant's create_product lands in the same editor, on «Фото и видео», as a real row", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const NAME = `Assist ${stamp} — масло для бороды`;
    await stubMedia(page, { cutout: false });
    let id = "";
    const asked: string[] = [];
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
        return;
      }
      const body = route.request().postDataJSON() as { mode?: string; messages?: Array<{ content: string }> };
      asked.push(`${body.mode}:${body.messages?.[body.messages.length - 1]?.content}`);
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          reply: "Завожу новый товар — подтвердите, и добавьте фото на вкладке «Фото и видео».",
          product_ids: [], tab: "goods",
          action: { type: "create_product", brand: "Proraso", name: NAME, cat: "beard", price: 12.5, sizes: [], prices: [12.5],
            description: { RU: "Масло для бороды.", ET: "Habemeõli.", EN: "Beard oil." } },
        }),
      });
    });

    await openAdmin(page);
    try {
      await page.locator(".adm-fab[data-admai]").click();
      await page.locator("[data-admq]").fill(`добавь новый товар Proraso ${NAME} за 12,50`);
      await page.locator("[data-admsend]").click();
      const answer = page.locator("[data-aians]");
      await expect(answer).toContainText("Завожу новый товар");
      expect(asked[0]).toMatch(/^admin:/);
      // the confirm card names the product, the price and the photos step
      const card = answer.locator(".adm-propose");
      await expect(card).toContainText(`Новый товар «Proraso — ${NAME}»`);
      await expect(card).toContainText(eur(12.5, "RU"));
      await expect(card).toContainText("Фото добавите");
      await card.locator("[data-admapply]").click();
      expect(await toastText(page)).toMatch(/Товар создан/);
      await clearToast(page);
      await expect(page.locator('[data-edtab="media"][aria-current="true"]')).toBeVisible();
      id = (await page.locator("[data-admsavegoods]").getAttribute("data-admsavegoods")) || "";
      expect(id).toMatch(/^c-proraso-assist-/);
      const row = await page.request.get(`/api/admin/products/${id}/`);
      expect((await row.json()).product).toMatchObject({ active: true, price: 12.5, cat: "beard", description: { RU: "Масло для бороды.", ET: "Habemeõli.", EN: "Beard oil." } });
      // the description the assistant wrote is on the «Описание» tab
      await edTab(page, "desc");
      expect(await page.locator("[data-eddescru]").inputValue()).toBe("Масло для бороды.");
      await assertClean(page, w, "assistant-created product");
    } finally {
      if (id) await page.request.delete(`/api/admin/products/${id}/`);
    }
  });
});
