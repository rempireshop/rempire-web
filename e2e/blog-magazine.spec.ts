import { expect, test, type Page } from "@playwright/test";
import { ipHeaders, loginAsAdmin, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";

/** The blog as a magazine (Dim, 02.11.2026 — canvas-banner/project/BlogHome,
 *  BlogPhone, Article): the featured story on top, the topic chips that filter
 *  the grid in the browser, the beige tile an article without a cover gets,
 *  and the article page's strip of products and its «Написано по материалам»
 *  box — shown only when the owner switched it on and there are lines in it.
 *
 *  The articles are made through the panel's own API with a signed-in
 *  session, so each test reads a state it set up itself; every one it made
 *  is deleted again (the row stays, deleted — src/lib/blog.ts deletePost). */
test.use({ extraHTTPHeaders: ipHeaders(83) });

const made: string[] = [];
test.afterEach(async ({ page }) => {
  while (made.length) {
    const id = made.pop() as string;
    await page.request.delete(`/api/admin/blog/?id=${encodeURIComponent(id)}`).catch(() => undefined);
  }
});

type Made = { id: string; slug: string };
async function post(page: Page, data: Record<string, unknown>, publish = true): Promise<Made> {
  const r = await page.request.post("/api/admin/blog/", { data });
  expect(r.status(), "the article was not created").toBe(200);
  const p = (await r.json()).post as Made;
  made.push(p.id);
  if (publish) {
    const pub = await page.request.patch("/api/admin/blog/", { data: { id: p.id, publish: true } });
    expect(pub.status(), "the article would not publish").toBe(200);
  }
  return p;
}
const words = (n: number) => "<p>" + "Слово ".repeat(n) + "</p>";

test.describe("blog home", () => {
  test("the chips filter the grid in the browser, and an article without a cover is a beige tile with its title", async ({ page }) => {
    await loginAsAdmin(page);
    const stamp = Date.now().toString(36);
    const bare = await post(page, {
      title: { RU: `Без обложки ${stamp}`, ET: "", EN: "" },
      excerpt: { RU: "Статья без картинки." },
      body: { RU: words(30) },
      topic: "skin",
    });
    // a newer one with a cover, so the bare one is in the grid and not the story on top
    await post(page, {
      title: { RU: `С обложкой ${stamp}`, ET: "", EN: "" },
      body: { RU: words(30) },
      coverUrl: "/shop/img/night-rider-0.webp", coverW: 400, coverH: 400,
      topic: "styling",
    });

    await page.goto(shopUrl("", "/blog/"));
    await waitForScreen(page, "blog");
    await expect(page.locator(".bmag-hero__slide").first()).toBeVisible();
    await expect(page.locator(".bmag__h")).toBeVisible();

    const tile = page.locator(`.bmag__card[data-go-blog="${bare.slug}"]`);
    await expect(tile).toBeVisible();
    await expect(tile.locator(".bmag__none .bmag__nonet")).toHaveText(`Без обложки ${stamp}`);
    await expect(tile.locator("img")).toHaveCount(0);
    // a card WITH a cover reserves its own shape before the picture has loaded
    const pic = page.locator(".bmag__card img.bmag__img").first();
    if (await pic.count()) {
      await expect(pic).toHaveAttribute("width", /^\d+$/);
      await expect(pic).toHaveAttribute("height", /^\d+$/);
    }

    // «Кожа»: only the skin articles stay, the beard sample goes (shopUrl("") is the Russian shop here)
    const skin = page.locator('[data-blogchip="skin"]');
    await expect(skin).toBeVisible();
    await skin.click();
    await expect(skin).toHaveAttribute("aria-pressed", "true");
    await expect(tile).toBeVisible();
    await expect(page.locator('.bmag__card[data-go-blog="uhod-za-borodoy-zimoy"]')).toHaveCount(0);
    const shown = await page.locator(".bmag__card").evaluateAll((els) => els.map((e) => e.querySelector(".bmag__eye")?.textContent));
    expect(shown.length).toBeGreaterThan(0);
    expect(new Set(shown)).toEqual(new Set(["Кожа"]));

    // «Все» brings everything back
    await page.locator('[data-blogchip=""]').click();
    await expect(page.locator('.bmag__card[data-go-blog="uhod-za-borodoy-zimoy"]')).toBeVisible();

    // the dark «Спросите помощника» card: on a desktop, where the chat lives — never on a phone
    const wide = (page.viewportSize()?.width ?? 0) >= 768;
    await expect(page.locator(".bmag__ask")).toHaveCount(wide ? 1 : 0);

    // nothing slides sideways on a phone
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sw).toBeLessThanOrEqual(1);
  });
});

test.describe("article page", () => {
  test("the strip of products, «All N products» down to the shelf, the read time — and the sources box only when it is switched on", async ({ page }) => {
    await loginAsAdmin(page);
    const stamp = Date.now().toString(36);
    const base = {
      excerpt: { RU: "Лид статьи." },
      body: { RU: "<h2>Раздел</h2>" + words(420) + "<h3>Подраздел</h3>" + words(20) },
      products: [PRODUCT.id, PRODUCT_2.id],
      sources: ["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee — жёсткость воды"],
      topic: "hair",
    };
    const shown = await post(page, { ...base, title: { RU: `Источники видны ${stamp}` }, showSources: true });
    const hidden = await post(page, { ...base, title: { RU: `Источники скрыты ${stamp}` }, showSources: false });

    await page.goto(shopUrl("/ru", `/blog/${shown.slug}/`));
    await waitForScreen(page, "blogpost");
    await expect(page.locator(".bmag-post__h1")).toHaveText(`Источники видны ${stamp}`);
    await expect(page.locator(".bmag-post__crumbs")).toContainText("Волосы");
    // 440 words at 200 a minute — rounded up
    await expect(page.locator(".bmag-post__by")).toContainText("3 мин чтения");
    await expect(page.locator(".bmag-post__by")).toContainText("Команда салона Rempire");
    await expect(page.locator(".bmag-post__lead")).toHaveText("Лид статьи.");

    const strip = page.locator(".bmag-strip");
    await expect(strip.locator(".bmag-strip__i")).toHaveCount(2);
    await expect(strip.locator(`.bmag-strip__i[data-go-product="${PRODUCT.id}"] .bmag-strip__pr`)).toContainText("от 9");
    await expect(strip.locator(".bmag-strip__all")).toHaveText("Все 2 товара");
    await strip.locator(".bmag-strip__all").click();
    await expect(page.locator("#post-products")).toBeInViewport();
    await expect(page.locator("#post-products .card")).toHaveCount(2);

    const src = page.locator(".bmag-src");
    await expect(src).toBeVisible();
    await expect(src).toContainText("Буклет Kevin.Murphy, PDF");
    await expect(src).toContainText("tallinnavesi.ee — жёсткость воды");
    // names only: never a link to a file
    await expect(src.locator("a")).toHaveCount(0);

    // «Читать дальше» — two more, the same topic first
    await expect(page.locator(".bmag-next .blog__tile").first()).toBeVisible();
    expect(await page.locator(".bmag-next .blog__tile").count()).toBeLessThanOrEqual(2);

    await page.goto(shopUrl("/ru", `/blog/${hidden.slug}/`));
    await waitForScreen(page, "blogpost");
    await expect(page.locator(".bmag-post__h1")).toHaveText(`Источники скрыты ${stamp}`);
    await expect(page.locator(".bmag-strip .bmag-strip__i")).toHaveCount(2);
    await expect(page.locator(".bmag-src")).toHaveCount(0);
    // …and the API itself does not hand the names out while the switch is off
    const api = await page.request.get(`/api/blog/${hidden.slug}/?lang=RU`);
    expect((await api.json()).post.sources).toEqual([]);
  });

  /* «+» on a product card inside the text (Dim, 02.11.2026 — Article.dc.html):
     the shop's own add, so the same basket line a card's «В корзину» makes —
     the cheapest size that can be sold, one of it, and the shop's toast. */
  test("the «+» on a card inside the text puts the product in the cart the way every card does", async ({ page }) => {
    await loginAsAdmin(page);
    const card = (id: string) => `<p><a data-product="${id}" data-price="live" href="/ru/products/${id}">${id}</a></p>`;
    const p = await post(page, {
      title: { RU: `С карточкой ${Date.now().toString(36)}` },
      body: { RU: "<h2>Шампунь</h2><p>Берите этот.</p>" + card(PRODUCT.id) + card(PRODUCT_2.id) },
      products: [PRODUCT.id, PRODUCT_2.id],
    });
    await page.goto(shopUrl("/ru", `/blog/${p.slug}/`));
    await waitForScreen(page, "blogpost");
    const add = page.locator(`.blog__body .blog__prodcard .blog__prodadd[data-add="${PRODUCT.id}"]`);
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute("aria-label", /^Добавить System 4 .+ в корзину$/);
    const box = await add.boundingBox();
    expect(Math.round(box!.width)).toBe(48);
    expect(Math.round(box!.height)).toBe(48);
    await add.click();
    await expect(page.getByRole("status")).toBeVisible();
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("rempire-shop-proto") || "{}").cart);
    // 75 мл — the cheapest of 75/250/500, the volume a catalogue card's «В корзину» baskets too
    expect(cart).toEqual([{ id: PRODUCT.id, size: 0, qty: 1 }]);
    // and the link beside it still opens the product
    await expect(page.locator(`.blog__body .blog__prod[data-go-product="${PRODUCT.id}"]`)).toHaveAttribute("href", `/ru/products/${PRODUCT.id}`);
    // the English page says it in English
    await page.goto(shopUrl("en", `/blog/${p.slug}/`));
    await waitForScreen(page, "blogpost");
    await expect(page.locator(`.blog__prodadd[data-add="${PRODUCT_2.id}"]`)).toHaveAttribute("aria-label", /^Add Kevin\.Murphy .+ to the cart$/);
  });

  test("the English article says its byline and strip in English", async ({ page }) => {
    await loginAsAdmin(page);
    const p = await post(page, {
      title: { RU: "Статья", EN: `An article ${Date.now().toString(36)}` },
      body: { RU: words(10), EN: words(10) },
      products: [PRODUCT.id, PRODUCT_2.id],
      topic: "beard",
    });
    await page.goto(shopUrl("en", `/blog/${p.slug}/`));
    await waitForScreen(page, "blogpost");
    await expect(page.locator(".bmag-post__crumbs")).toContainText("Beard");
    await expect(page.locator(".bmag-post__by")).toContainText("Rempire salon team");
    await expect(page.locator(".bmag-post__by")).toContainText("1 min read");
    await expect(page.locator(".bmag-strip__h")).toHaveText("In this article");
    await expect(page.locator(".bmag-strip__all")).toHaveText("All 2 products");
  });
});
