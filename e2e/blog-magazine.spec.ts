import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
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
    await expect(page.locator('.hero__slide[data-on="1"]')).toBeVisible();
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

/* Dim, 02.11.2026: the featured story on top of the blog «must look and
   behave EXACTLY like the home banner» — his screenshot showed the square
   Kevin.Murphy cover as a framed square box on the right of a beige band.
   So it is the home banner: the same band and classes, the look picked by
   the cover's shape as an upload of the home banner picks its own, the same
   heights and arrows, no dots — and the static page the same box as the one
   the script paints over it. */
test.describe("blog home — the featured band is the home banner", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sets its own phone and computer viewports — desktop project only");
  });

  async function picture(w: number, h: number): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a5a6b"/><stop offset="1" stop-color="#c9b79c"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.5}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.22}" fill="#efe6d6"/></svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
  }
  async function servePictures(page: Page): Promise<void> {
    await page.addInitScript(() => { try { sessionStorage.setItem("rempire-intro", "1"); } catch { /* private mode */ } });
    const wide = await picture(1600, 900);
    const square = await picture(1095, 1095);
    await page.route(/\/e2e-blog\/(wide|square)\.webp$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: /wide/.test(route.request().url()) ? wide : square }));
  }
  /** The band's box, its slides' kinds in order, and the one on screen. */
  async function readBand(page: Page) {
    const band = page.locator("section.hero");
    await expect(band).toBeVisible();
    return {
      box: await band.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
      kinds: await band.locator(".hero__slide").evaluateAll((els) => els.map((e) => e.className)),
      on: await band.locator('.hero__slide[data-on="1"]').getAttribute("data-kind"),
    };
  }
  async function noScript(browser: Browser, url: string, vp: { width: number; height: number }) {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: vp, extraHTTPHeaders: ipHeaders(84), locale: "ru-RU" });
    const page = await ctx.newPage();
    const wide = await picture(1600, 900), square = await picture(1095, 1095);
    await page.route(/\/e2e-blog\/(wide|square)\.webp$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: /wide/.test(route.request().url()) ? wide : square }));
    await page.goto(url);
    const got = await readBand(page);
    await ctx.close();
    return got;
  }

  test("a landscape cover is «на всю ширину», a square one «на половину» — the home banner's band, heights and arrows", async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const stamp = Date.now().toString(36);
    // the square one first, so the landscape one is the newest — the first slide
    const sq = await post(page, {
      title: { RU: `Квадратная обложка ${stamp}` }, excerpt: { RU: "Как выбрать шампунь Kevin.Murphy под свои волосы." },
      body: { RU: words(40) }, coverUrl: "/e2e-blog/square.webp", coverW: 1095, coverH: 1095, topic: "hair", featured: true,
    });
    const wd = await post(page, {
      title: { RU: `Широкая обложка ${stamp}` }, excerpt: { RU: "Тонер с кислотами: как выбрать и как пользоваться." },
      body: { RU: words(40) }, coverUrl: "/e2e-blog/wide.webp", coverW: 1600, coverH: 900, topic: "skin", featured: true,
    });
    await servePictures(page);
    const url = shopUrl("", "/blog/");

    for (const vp of [{ width: 1440, height: 900 }, { width: 2000, height: 1100 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.goto(url);
      await waitForScreen(page, "blog");
      const band = page.locator("section.hero");
      await expect(band).toHaveAttribute("aria-label", "Избранные статьи");
      // the two featured articles, the newest first, each in the home banner's look for its shape
      const wide = band.locator(".hero__slide").filter({ hasText: `Широкая обложка ${stamp}` });
      const half = band.locator(".hero__slide").filter({ hasText: `Квадратная обложка ${stamp}` });
      await expect(wide).toHaveClass("hero__slide hero__slide--wide hero__slide--left");
      await expect(wide).toHaveAttribute("data-kind", "wide");
      await expect(half).toHaveClass("hero__slide hero__slide--half");
      await expect(half).toHaveAttribute("data-kind", "half");
      await expect(wide).toHaveAttribute("data-on", "1");
      await expect(band).toHaveAttribute("data-kind", "wide");
      expect(await wide.locator(".hero__title").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
      expect(await half.locator(".hero__title").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(28, 26, 0)");
      // none of the old carousel: no dots, no scroll track
      await expect(page.locator(".bmag-hero, .bmag-hero__dot, [data-bmagdot], .hero__dot")).toHaveCount(0);
      const b = (await band.boundingBox())!;
      const title = (await wide.locator(".hero__title").boundingBox())!;
      const btn = (await wide.locator(".btn").boundingBox())!;
      for (const [name, x] of [["title", title], ["button", btn]] as const) {
        expect(x.y, `${name} above the band at ${vp.width}`).toBeGreaterThanOrEqual(b.y - 1);
        expect(x.y + x.height, `${name} below the band at ${vp.width}`).toBeLessThanOrEqual(b.y + b.height + 1);
      }
      await expect(wide.locator(".btn")).toHaveAttribute("href", new RegExp(`/${wd.slug}/?$`));
      await expect(wide.locator(".btn")).toHaveAttribute("data-go-blog", wd.slug);
      if (vp.width === 390) {
        expect(b.height, `phone band ${b.height}`).toBeGreaterThanOrEqual(465);
        expect(b.height, `phone band ${b.height}`).toBeLessThanOrEqual(495);
      } else {
        expect(b.height, `band ${b.height} at ${vp.width}`).toBeLessThanOrEqual(450);
      }
      await band.screenshot({ path: testInfo.outputPath(`blog-band-${vp.width}-wide.png`) });

      // the home banner's arrows move it, and say where they go
      const next = band.locator(".hero__arrow--next");
      await expect(next).toHaveAttribute("aria-label", "Следующая статья — 2 из 2");
      await next.click();
      await expect(half).toHaveAttribute("data-on", "1");
      await expect(band).toHaveAttribute("data-kind", "half");
      // the crossfade has finished (the screenshots below are of the slide, not of the two halfway)
      await expect(half).toHaveCSS("opacity", "1");
      await expect(wide).toHaveCSS("opacity", "0");
      await expect(next).toHaveAttribute("aria-label", "Следующая статья — 1 из 2");
      if (vp.width !== 390) {
        // the square photo: the right part of the shop's column, never wider than the column
        const ph = (await half.locator(".hero__photo").boundingBox())!;
        const box = (await half.locator(".hero__box").boundingBox())!;
        expect(ph.width, JSON.stringify({ ph, box })).toBeLessThanOrEqual(Math.min(b.width, 1240) * 0.62 + 1);
        expect(ph.x + ph.width).toBeLessThanOrEqual(box.x + box.width + 1);
        expect(Math.abs(ph.height - b.height)).toBeLessThan(2);
        expect(Math.max(ph.width, ph.height), "the 1095-px cover is blown up").toBeLessThanOrEqual(1095);
      }
      await band.screenshot({ path: testInfo.outputPath(`blog-band-${vp.width}-half.png`) });
      await page.screenshot({ path: testInfo.outputPath(`blog-page-${vp.width}.png`) });
      // the band is as tall as the home page's at this width: one band, one height
      const blogH = (await band.boundingBox())!.height;
      await page.goto(shopUrl("", "/"));
      await waitForScreen(page, "home");
      const homeH = (await page.locator("section.hero").boundingBox())!.height;
      expect(Math.abs(homeH - blogH), `home ${homeH} vs blog ${blogH} at ${vp.width}`).toBeLessThanOrEqual(1);

      // the static page (a crawler's, a reader's with scripts off) draws the same band — the same box, the same slides
      await page.goto(url);
      await waitForScreen(page, "blog");
      const live = await readBand(page);
      const cold = await noScript(browser, url, vp);
      expect(cold.kinds).toEqual(live.kinds);
      expect(cold.on).toBe(live.on);
      expect(Math.abs(cold.box.height - live.box.height), `static ${cold.box.height} vs live ${live.box.height} at ${vp.width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(cold.box.width - live.box.width)).toBeLessThanOrEqual(1);
    }
    expect(sq.slug).toBeTruthy();
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
    /* The article is redrawn once late data lands; a box read across that
       redraw is null (release run, 02.11.2026) — poll until it holds. */
    await expect.poll(async () => {
      const box = await add.boundingBox();
      return box ? [Math.round(box.width), Math.round(box.height)] : null;
    }).toEqual([48, 48]);
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
