import { expect, type Browser, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./env.mjs";
import { eur, ipHeaders, LANGS, PRODUCT, shopUrl, waitForScreen } from "./fixtures";
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
 *     lands in the same editor, on the same tab, as a real row;
 *   · the product's page is a real page before app.js runs — the server
 *     writes its head from the row (src/lib/product-page.ts), the app's own
 *     sitemap names it, «Сообщить о наличии» takes it, and once hidden the
 *     address answers 404 with noindex.
 *
 * Everything this spec makes is taken off sale at the end, so the specs that
 * count the catalogue never see it.
 *
 * The second describe at the bottom is about a CATALOGUE product rather than
 * one of the owner's own: hiding it has to withhold a page that is already a
 * file on disk, which is a different layer and a different promise
 * (docs/seo.md, «The one thing that runs before the file»).
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
    // the photo tile is there from the start — picking a photo saves the
    // product first (the test below) — with the one line that says so
    await edTab(page, "media");
    await expect(page.locator('[data-galup="new"]'), "no photo tile on a new product").toBeEnabled();
    await expect(page.locator("[data-galwait]")).toContainText("товар сохранится сам");
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
      /* The dev server compiles a route on its first hit, and the row's own
         route (PUT below) took 4.7 s cold on a fresh server — longer than
         toastText() waits for «Сохранено». Warm it here, before the timing
         matters; nothing about production needs this. */
      expect((await page.request.get(`/api/admin/products/${id}/`)).status()).toBe(200);

      // ---- a photo, and «Убрать фон» when the server offers it -------------
      await expect(page.locator(`[data-galup="${id}"]`)).toBeEnabled();
      await page.locator(`[data-galfile="${id}"]`).setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: PNG });
      await expect(page.locator(".adm-photo:not(.adm-photo--add)")).toHaveCount(1);
      expect(uploads).toContain("upload");
      // the tile is on screen, the shop has not seen it yet — the toast says what makes it so
      expect(await toastText(page), "no nudge to press «Сохранить» after the upload").toMatch(/Фото загружено/);
      await clearToast(page);
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
      /* A product taken out of the shop leaves a dead address behind, and since
         07.09.2026 a dead address says so rather than quietly showing the home
         page (Dim: «make a page not found»). */
      await waitForScreen(gone.page, "notfound");
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

  /**
   * Round 12 (Dim, 10.09.2026): a photo on a NEW product. The media tab used
   * to be a dead end — «Фото — после первого сохранения» and nothing to
   * press — and an upload that failed on staging said only «попробуйте ещё
   * раз». Pinned here:
   *   · a photo picked with the form empty uploads nothing: the save bar
   *     names the empty box and the tab that holds it opens by itself;
   *   · with the form filled, the photo MAKES the product (the same POST the
   *     save bar sends), lands on it, and «Сохранить» then puts it in the shop;
   *   · a refused upload — no bucket, no connection, a body the platform
   *     will not take — is a sentence in the pane every time.
   */
  test("a photo picked before the first save makes the product, and an upload that fails says why", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const BRAND = `E2E Photo ${stamp}`;
    const NAME = `Oil ${stamp} — масло для бороды`;
    const FILE = { name: "e2e.png", mimeType: "image/png", buffer: PNG };
    let mode: "ok" | "storage" | "offline" | "huge" = "ok";
    const posted: string[] = [];
    await page.route("**/api/admin/upload/**", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, configured: true, cutout: false, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
        return;
      }
      if (req.method() !== "POST") { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); return; }
      posted.push(mode);
      if (mode === "storage") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "storage_not_configured" }) });
      } else if (mode === "offline") {
        await route.abort("failed");
      } else if (mode === "huge") {
        // what a Vercel function answers to a body over 4.5 MB — before any code of ours runs, and not JSON
        await route.fulfill({ status: 413, contentType: "text/plain", body: "FUNCTION_PAYLOAD_TOO_LARGE" });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, key: "products/e2e/2-e2e.webp", url: PHOTO_URL, thumbUrl: PHOTO_URL, width: 1, height: 1, bytes: 10, alt: "" }) });
      }
    });
    let id = "";

    await openAdmin(page);
    try {
      await tab(page, "goods");
      await page.locator("[data-admgoodsnew]").click();
      await expect(page.locator("[data-edbrand]")).toBeVisible();

      // ---- the form is empty: nothing is uploaded, the empty box gets the caret, on its own tab
      await edTab(page, "media");
      await page.locator('[data-galfile="new"]').setInputFiles(FILE);
      await expect(page.locator("[data-goodserr]")).toContainText("Впишите бренд");
      await expect(page.locator('[data-edtab="main"][aria-current="true"]'), "the refusal did not open the tab with the empty box").toBeVisible();
      await expect(page.locator("[data-edbrand]")).toBeFocused();
      expect(posted, "a photo was uploaded with no product to file it under").toEqual([]);

      // ---- filled in, the photo makes the product and lands on it
      await page.locator("[data-edbrand]").fill(BRAND);
      await page.locator("[data-edname]").fill(NAME);
      await page.locator("[data-edcat]").selectOption("beard");
      await edTab(page, "sizes");
      await page.locator("[data-edprice]").fill("9,90");
      await edTab(page, "media");
      await page.locator('[data-galfile="new"]').setInputFiles(FILE);
      await expect(page.locator(".adm-photo:not(.adm-photo--add)"), "the photo did not land on the created product").toHaveCount(1);
      id = (await page.locator("[data-admsavegoods]").getAttribute("data-admsavegoods")) || "";
      expect(id, "the editor did not move onto the created product").toMatch(/^c-e2e-photo-/);
      await expect(page.locator('[data-edtab="media"][aria-current="true"]')).toBeVisible();
      expect(posted).toEqual(["ok"]);
      expect(await customRow(page, id)).toMatchObject({ active: true, price: 9.9 });
      await clearToast(page);
      // «Сохранить» is what puts the photo in the shop — the pane says so, and it does
      await expect(page.locator('[data-edpane="media"]')).toContainText("нажмите «Сохранить»");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await expect.poll(async () => (await customRow(page, id))?.gallery?.[0], { timeout: 15_000 }).toBe(PHOTO_URL);
      await assertClean(page, w, "created through the photo");

      // ---- every refusal is a sentence in the pane, never a silent stop
      await openEditor(page, id);
      await edTab(page, "media");
      const refusal = page.locator("[data-uperr]");
      mode = "storage";
      await page.locator(`[data-galfile="${id}"]`).setInputFiles(FILE);
      await expect(refusal).toContainText("Не удалось загрузить фото: хранилище фото не настроено");
      mode = "offline";
      await page.locator(`[data-galfile="${id}"]`).setInputFiles(FILE);
      await expect(refusal).toContainText("Не удалось загрузить фото: нет связи");
      mode = "huge";
      await page.locator(`[data-galfile="${id}"]`).setInputFiles(FILE);
      await expect(refusal).toContainText("Не удалось загрузить фото: файл слишком большой для сервера");
      await expect(page.locator(".adm-photo:not(.adm-photo--add)"), "a refused upload left a tile behind").toHaveCount(1);
      await expect(page.locator(`[data-galup="${id}"]`), "the tile stayed busy after a refusal").toBeEnabled();
      // the three refusals were provoked: the 503 and the aborted request are
      // the test's own, not the panel's — a thrown error would still fail here
      expect(w.pageErrors, "uncaught page error during a refused upload").toEqual([]);
      w.reset();
      await assertClean(page, w, "upload refusals");
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

  test("the product's page is a real page for a crawler: head from the row, «Сообщить о наличии», the sitemap, 404 once hidden", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const BRAND = `E2E Seo ${stamp}`;
    const NAME = `Tonic ${stamp} — тоник для бороды`;
    const TITLE = `${BRAND} тоник — купить`;
    await stubMedia(page, { cutout: false });
    let id = "";

    await openAdmin(page);
    try {
      // ---- created through the UI, the way the owner does it -----------------
      await tab(page, "goods");
      await page.locator("[data-admgoodsnew]").click();
      await expect(page.locator("[data-edbrand]")).toBeVisible();
      await page.locator("[data-edbrand]").fill(BRAND);
      await page.locator("[data-edname]").fill(NAME);
      await page.locator("[data-edcat]").selectOption("beard");
      await edTab(page, "sizes");
      await page.locator("[data-edprice]").fill("21,50");
      await page.locator('[data-admsavegoods="new"]').click();
      expect(await toastText(page)).toMatch(/Товар создан/);
      await clearToast(page);
      id = (await page.locator("[data-admsavegoods]").getAttribute("data-admsavegoods")) || "";
      expect(id).toMatch(/^c-e2e-seo-/);
      await assertClean(page, w, "created");
      // the texts the head is built from — an Estonian description and a
      // Russian Google pair — through the same PUT the editor's «Сохранить» sends
      const texts = await page.request.put(`/api/admin/products/${id}/`, {
        data: { description: { RU: "Тоник для бороды.", ET: "Habemetoonik." }, seo: { RU: { title: TITLE, desc: "Тоник в Rempire." } } },
      });
      expect(texts.status()).toBe(200);

      // ---- a fresh, logged-out visitor's Estonian page --------------------------
      const shop = await freshShop(browser);
      const res = await shop.page.goto(shopUrl("/et", `/p/${id}/`));
      expect(res?.status()).toBe(200);
      // what the server sent, before any script ran: the head from the row
      const served = (await res!.text()).replace(/\r\n?/g, "\n");
      expect(served).toMatch(/^<!doctype html>\n<html lang="et">/);
      expect(served).toContain(`<title>${TITLE} — REMPIRE</title>`);
      expect(served).toContain('<meta name="description" content="Тоник в Rempire.">');
      expect(served).toContain(`<link rel="canonical" href="${E2E_BASE_URL}/shop2/et/p/${id}/" data-seo="canonical">`);
      expect(served).toContain(`<link rel="alternate" hreflang="x-default" href="${E2E_BASE_URL}/shop2/p/${id}/" data-seo="alt-x">`);
      expect(served).toContain('<meta property="og:locale" content="et_EE"');
      // the link preview: the shop's own card, drawn from the row at request time (src/lib/og-card.ts)
      expect(served).toContain(`<meta property="og:image" content="${E2E_BASE_URL}/shop2/og/${id}.png?v=`);
      expect(served).toContain('<meta property="og:image:type" content="image/png">');
      const card = await page.request.get(`/shop2/og/${id}.png`);
      expect(card.status(), "the product card did not render").toBe(200);
      expect(card.headers()["content-type"]).toBe("image/png");
      expect(card.headers()["etag"]).toMatch(/^"og-/);
      expect((await card.body()).length).toBeGreaterThan(1000);
      expect(served).toContain(`<h1 class="pdp__title">${NAME}</h1>`);
      expect(served).toContain("Habemetoonik.");
      // …and what the browser shows once app.js has taken over: the same head
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(`${TITLE} — REMPIRE`);
      expect(await shop.page.locator('meta[name="description"]').getAttribute("content")).toBe("Тоник в Rempire.");
      const ld = JSON.parse((await shop.page.locator("script#ldjson").textContent()) || "{}") as { name?: string; offers?: { price?: string } };
      expect(ld.name).toBe(`${BRAND} ${NAME}`);
      expect(ld.offers?.price).toBe("21.5");
      await expect(shop.page.locator('link[rel="alternate"][hreflang]')).toHaveCount(4);
      await expect(shop.page.locator("[data-price]")).toHaveText(eur(21.5, "ET"));
      await assertClean(shop.page, shop.w, "custom product page, ET");
      await shop.close();

      // ---- the sitemap the app serves names it, in three languages ---------------
      const sm = await page.request.get("/sitemap-custom.xml");
      expect(sm.status()).toBe(200);
      expect(sm.headers()["content-type"]).toContain("xml");
      const xml = await sm.text();
      for (const seg of ["", "/et", "/en"]) expect(xml, seg || "ru").toContain(`<loc>${E2E_BASE_URL}/shop2${seg}/p/${id}/</loc>`);
      expect(await (await page.request.get("/sitemap.xml")).text()).toContain("/sitemap-custom.xml");

      // ---- «Сообщить о наличии»: sold out by the owner, an address left by a shopper ----
      const out = await page.request.put("/api/admin/overrides/", { data: { id, stock: "out" } });
      expect(out.status()).toBe(200);
      const waiting = await freshShop(browser);
      await waiting.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(waiting.page, "product");
      await waiting.page.locator(`[data-notify="${id}"]`).click();
      await waiting.page.locator("[data-notifyf]").fill(`e2e-seo-${stamp}@example.com`);
      const [alert] = await Promise.all([
        waiting.page.waitForResponse((r) => r.url().includes("/api/stock-alerts/") && r.request().method() === "POST"),
        waiting.page.locator(`[data-notifysend="${id}"]`).click(),
      ]);
      expect(alert.status(), "the stock-alert route refused the custom id").toBe(200);
      expect((await alert.json()).ok).toBe(true);
      await expect(waiting.page.getByRole("status")).toContainText("Записали");
      await assertClean(waiting.page, waiting.w, "stock alert on a custom product");
      await waiting.close();
      // the panel's «Маркетинг» counter sees the address waiting
      const flows = await page.request.get("/api/admin/flows/");
      expect((await flows.json()).counters.alerts).toBeGreaterThanOrEqual(1);
      // …and the served page says sold out too
      expect(await (await page.request.get(shopUrl("", `/p/${id}/`))).text()).toContain('"availability":"https://schema.org/OutOfStock"');
      expect((await page.request.put("/api/admin/overrides/", { data: { id, stock: null } })).status()).toBe(200);

      // ---- hidden: 404 with noindex, gone from the sitemap, the browser still lands home ----
      expect((await page.request.delete(`/api/admin/products/${id}/`)).status()).toBe(200);
      for (const seg of ["", "/et", "/en"]) {
        const gone = await page.request.get(shopUrl(seg, `/p/${id}/`));
        expect(gone.status(), seg || "ru").toBe(404);
        expect(await gone.text()).toContain('<meta name="robots" content="noindex, nofollow">');
      }
      expect(await (await page.request.get("/sitemap-custom.xml")).text()).not.toContain(id);
      const hidden = await freshShop(browser);
      const r404 = await hidden.page.goto(shopUrl("/et", `/p/${id}/`));
      expect(r404?.status()).toBe(404);
      /* Since 07.09.2026 a dead address gets a page that says so instead of
         the home page underneath it (Dim: «make a page not found»), so app.js
         settles on its own «Страница не найдена» screen here. */
      await waitForScreen(hidden.page, "notfound");
      await hidden.close();
    } finally {
      if (id) {
        await page.request.put("/api/admin/overrides/", { data: { id, stock: null } });
        await page.request.delete(`/api/admin/products/${id}/`);
      }
    }
  });
});

/* ---------- a catalogue product, hidden, with no rebuild -------------------
 *
 * The custom product above never had a static page, so 404ing it was only ever
 * a matter of the route saying so. A CATALOGUE product is the hard case and the
 * one Dim answered on 08.09.2026 («if the item is hidden, it should be hidden
 * without any deploys or rebuilds»): tools/prerender-shop2.mjs wrote its page
 * to disk at build time, and the static layer answers a file before any route
 * runs — on Vercel by itself, here through `prerenderedRewrites()` in
 * next.config.ts. So until src/middleware.ts started asking first, «Показывать
 * в магазине» took the product out of the shop everywhere except the one
 * address Google holds.
 *
 * This is the spec for that. It runs against exactly the tree `node
 * tools/e2e-build.mjs` prerendered — no second build, no restart — and it
 * checks both directions, because a switch that cannot be switched back is a
 * different bug.
 */
test.describe("admin — «Показывать в магазине» on a catalogue product", () => {
  /* A product no other spec touches (nothing in e2e/ or tests/ names it) and
     that is not in the home page's prerendered grid, so hiding it for the few
     seconds this test takes cannot move anything else. */
  const ID = "system-4-hydro-care-conditioner-h";

  test("its prerendered page stops being served the moment the switch goes off, and comes back", async ({ page, browser }) => {
    const w = watch(page);
    await openAdmin(page);
    const setHidden = (hidden: boolean) =>
      page.request.put("/api/admin/overrides/", { data: { id: ID, hidden } });
    try {
      /* The dev server compiles a route on its first hit; the middleware asks
         /api/overrides/hidden/ on every product page and will not wait forever
         for an answer, so warm it before the timing matters. Nothing about
         production needs this. */
      expect((await page.request.get("/api/overrides/hidden/")).status()).toBe(200);

      // ---- as built: the static file, with the product's own head ----------
      for (const seg of ["", "/et", "/en"]) {
        const res = await page.request.get(shopUrl(seg, `/p/${ID}/`));
        expect(res.status(), seg || "ru").toBe(200);
        const html = await res.text();
        /* The page tools/prerender-shop2.mjs wrote, not the shell: the shell's
           canonical is the home page's and it has no product <h1>. (The robots
           meta is not the tell — this suite builds against localhost, so every
           page is noindex here on purpose, docs/seo.md.) */
        expect(html, seg || "ru").toContain(`<link rel="canonical" href="${E2E_BASE_URL}/shop2${seg}/p/${ID}/"`);
        expect(html, seg || "ru").toContain('<h1 class="pdp__title">');
        expect(html, seg || "ru").toContain('"@type":"Product"');
      }
      // …and it is in the sitemap the app serves for the catalogue
      const listed = await (await page.request.get("/sitemap-products.xml")).text();
      expect(listed).toContain(`/shop2/p/${ID}/`);
      expect(listed).toContain(`/shop2/et/p/${ID}/`);

      // ---- switched off: 404 with noindex, in all three languages ----------
      expect((await setHidden(true)).status()).toBe(200);
      for (const seg of ["", "/et", "/en"]) {
        const gone = await page.request.get(shopUrl(seg, `/p/${ID}/`));
        expect(gone.status(), seg || "ru").toBe(404);
        const html = await gone.text();
        expect(html, seg || "ru").toContain('<meta name="robots" content="noindex, nofollow">');
        /* The page the build wrote is genuinely withheld, not merely
           restatused: no product <h1>, and the canonical is no longer this
           address claiming to be a product page. */
        expect(html, seg || "ru").not.toContain('<h1 class="pdp__title">');
        expect(html, seg || "ru").not.toContain(`<link rel="canonical" href="${E2E_BASE_URL}/shop2${seg}/p/${ID}/"`);
      }
      // gone from the sitemap too, without anything being rebuilt
      const dropped = await (await page.request.get("/sitemap-products.xml")).text();
      expect(dropped).not.toContain(`/p/${ID}/`);
      // the shop as a whole is still listed — hiding one product is not un-listing 220
      expect(dropped).toContain(`/shop2/p/${PRODUCT.id}/`);

      // ---- and a real browser lands on «Страница не найдена» ---------------
      const shopper = await freshShop(browser);
      const r404 = await shopper.page.goto(shopUrl("/et", `/p/${ID}/`));
      expect(r404?.status()).toBe(404);
      await waitForScreen(shopper.page, "notfound");
      await shopper.close();

      // ---- back on: the same static page as before -------------------------
      expect((await setHidden(false)).status()).toBe(200);
      const back = await page.request.get(shopUrl("", `/p/${ID}/`));
      expect(back.status()).toBe(200);
      expect(await back.text()).toContain('<h1 class="pdp__title">');
      expect(await (await page.request.get("/sitemap-products.xml")).text()).toContain(`/shop2/p/${ID}/`);
      await assertClean(page, w, "hidden catalogue product");
    } finally {
      await setHidden(false);
    }
  });
});
