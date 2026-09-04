import { expect, test } from "@playwright/test";
import { LANGS, PRODUCT, ipHeaders, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, freshShop, openAdmin, tab, watch } from "./sweep-helpers";

/**
 * The blog's visual editor, end to end: write one post with every toolbar
 * button that puts something in the text, publish it, and read the article
 * back off the storefront — a heading, bold, a list, a picture and a product
 * card, all rendered from the HTML that was actually stored (docs/blog.md).
 *
 * Plus the three sample posts db/migrations/071_blog_samples.sql seeds: they
 * are the first thing anyone opening /shop2/blog/ sees, in all three
 * languages, so they are checked as the shipped content they are.
 *
 * The escaping/refusal half of the blog lives in sweep-admin-ops.spec.ts —
 * this file is about the editor doing what its buttons say.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin editor — desktop project only, see docs/testing.md");
});

/* The URL pasted into the «Картинка» sheet — the path that matters when R2 is
   not configured, which is this suite's case. A picture the shop really
   serves, so the article below is checked with an <img> that actually loads:
   an unreachable host would make assertClean() fail on the browser's own
   network console error, and rightly. (An https:// URL and the refusal of an
   http:// one are covered in tests/blog.test.ts.) */
const IMAGE_URL = "/shop/img/proraso-wood-spice-beard-balm-100ml-0.webp";

test.describe("blog — the visual editor", () => {
  test.use({ extraHTTPHeaders: ipHeaders(171) });

  test("a post written with the toolbar reaches the shop as a heading, bold, a list, a picture and a product card", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "blog");

    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box, "the body is not a visual editor").toBeVisible();
    expect(await page.locator('textarea[data-blogf="body"]').count(), "the markdown textarea is still there").toBe(0);
    expect(await page.getByText("Предпросмотр").count(), "editor and preview are both on screen").toBe(0);

    const marker = `Редактор ${Date.now().toString().slice(-6)}`;
    await page.locator('[data-blogf="title"]').fill(marker);
    await page.locator('[data-blogf="excerpt"]').fill("Проверка визуального редактора.");

    /* The two INSERT buttons go first, into the empty box, and the three
       formatting ones after: both put the caret back in a plain paragraph of
       their own, so every step below acts on a block this test put there —
       no assumptions about what Enter does at the end of a heading or of a
       list, which is the one thing browsers genuinely disagree about. */

    /* ---- Картинка: no bucket in this suite, so the sheet takes a URL ----- */
    await box.click();
    await page.locator('[data-blogrt="image"]').click();
    const urlField = page.locator("[data-blogtoolurl]");
    await expect(urlField, "the «Картинка» sheet did not offer a URL to paste").toBeVisible();
    await urlField.fill(IMAGE_URL);
    await page.locator('[data-blogtoolok="image"]').click();
    await expect(box.locator("figure img")).toHaveAttribute("src", IMAGE_URL);

    /* ---- Товар ---------------------------------------------------------- */
    await page.locator('[data-blogrt="product"]').click();
    await page.locator("[data-blogtoolq]").fill(PRODUCT.id);
    await page.locator(`[data-blogtoolpick="${PRODUCT.id}"]`).click();
    await expect(box.locator(`a[data-product="${PRODUCT.id}"]`)).toBeVisible();
    await expect(page.locator("[data-blogtoolq]"), "the sheet stayed open after inserting").toHaveCount(0);

    /* ---- Заголовок ------------------------------------------------------ */
    await page.keyboard.press("Enter");
    await page.keyboard.type("Подзаголовок раздела");
    await page.locator('[data-blogrt="h2"]').click();
    await expect(box.locator("h2")).toHaveText("Подзаголовок раздела");

    /* ---- Жирный --------------------------------------------------------- */
    await page.keyboard.press("Enter");
    await page.keyboard.type("Масло каждый день.");
    /* Enter at the end of a heading keeps the heading in some browsers and
       starts a paragraph in others — «Заголовок» is a toggle, so one press
       puts the new line back to a paragraph wherever it did. */
    if ((await box.locator("h2").count()) > 1) await page.locator('[data-blogrt="h2"]').click();
    await expect(box.locator("h2"), "the second line stayed a heading").toHaveCount(1);
    await page.keyboard.press("Shift+Home");
    await page.locator('[data-blogrt="bold"]').click();
    /* execCommand("bold") writes <b> in Chrome and <strong> elsewhere — which
       is exactly what the allowlist normalises on save, so the box is checked
       for either and the STORED html below is checked for <strong>. */
    await expect(box.locator("strong, b").first()).toHaveText("Масло каждый день.");
    await page.keyboard.press("End");

    /* ---- Список: last, so nothing has to climb back out of it ------------ */
    await page.keyboard.press("Enter");
    await page.keyboard.type("Пункт списка");
    await page.locator('[data-blogrt="ul"]').click();
    await expect(box.locator("ul li")).toHaveText("Пункт списка");

    await assertClean(page, w, "blog editor filled in");

    /* 375 px — Renat writes on his phone as often as not. All seven buttons
       have to be reachable without a sideways scroll: the row wraps. */
    await page.setViewportSize({ width: 375, height: 780 });
    const bar = page.locator(".adm-tools");
    await expect(bar).toBeVisible();
    for (const cmd of ["h2", "bold", "italic", "ul", "link", "image", "product", "undo"]) {
      await expect(page.locator(`[data-blogrt="${cmd}"]`), `«${cmd}» is off screen at 375 px`).toBeInViewport();
    }
    const barOverflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(barOverflow, "the toolbar scrolls sideways at 375 px instead of wrapping").toBeLessThanOrEqual(1);
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow, "the editor spills sideways at 375 px").toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });

    const slug = await page.locator("[data-blogslug]").inputValue();
    expect(slug).toMatch(/^[a-z0-9-]+$/);

    await page.locator("[data-admblogpublish]").click();
    await clearToast(page);
    await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();

    /* ---- what the shopper gets ------------------------------------------ */
    const api = await page.request.get(`/api/blog/${slug}/?lang=RU`);
    expect(api.status(), "the published post is not on the public API").toBe(200);
    const bodyHtml = (await api.json()).post.bodyHtml as string;
    expect(bodyHtml).toContain("<h2>Подзаголовок раздела</h2>");
    expect(bodyHtml).toContain("<strong>");
    expect(bodyHtml).toContain("<li>");
    expect(bodyHtml).toContain(`<img src="${IMAGE_URL}"`);
    expect(bodyHtml).toContain(`data-product="${PRODUCT.id}"`);
    expect(bodyHtml.toLowerCase(), "the server let a script through").not.toContain("<script");

    const shop = await freshShop(browser);
    await shop.page.goto(shopUrl("", `/blog/${slug}/`));
    await waitForScreen(shop.page, "blogpost");
    const article = shop.page.locator(".blog__body");
    await expect(article.locator("h2")).toHaveText("Подзаголовок раздела");
    await expect(article.locator("strong").first()).toBeVisible();
    await expect(article.locator("ul li")).toHaveText("Пункт списка");
    await expect(article.locator("img")).toHaveAttribute("src", IMAGE_URL);
    // the «Товар» marker became the blog's own product card, and it works
    const card = article.locator(`.blog__prod[data-go-product="${PRODUCT.id}"]`);
    await expect(card, "the product marker did not become a card").toBeVisible();
    await expect(card).toContainText(PRODUCT.brand);
    await card.click();
    await waitForScreen(shop.page, "product");
    await assertClean(shop.page, shop.w, "the published post in the shop");
    await shop.close();

    // put it back in the drafts: this suite leaves the blog as it found it
    await page.locator("[data-admblogunpublish]").click();
    await clearToast(page);
    await assertClean(page, w, "blog editor test cleaned up");
  });

  test("an older markdown post opens in the visual editor as real headings and lists", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);

    /* A post as the assistant writes them, and as every post written before
       the editor changed looks: markdown in the body column. Posted through
       the API so it really is stored that way. */
    const marker = `Маркдаун ${Date.now().toString().slice(-6)}`;
    const created = await page.request.post("/api/admin/blog/", {
      data: {
        title: { RU: marker, ET: "", EN: "" },
        body: { RU: "Вступление.\n\n## Масло каждый день\n\n- капля\n- две", ET: "", EN: "" },
      },
    });
    expect(created.status()).toBe(200);
    const post = (await created.json()).post as { id: string; body: { RU: string } };
    // …and the newlines really did survive the save — the bug this editor replaced
    expect(post.body.RU, "the body was flattened into one line").toContain("\n## Масло каждый день");

    await tab(page, "blog");
    await page.locator(`[data-admblogedit="${post.id}"]`).click();
    const box = page.locator("[data-blogbody]");
    await expect(box.locator("h2")).toHaveText("Масло каждый день");
    await expect(box.locator("ul li")).toHaveCount(2);
    expect(await box.textContent(), "the markdown markers are still on screen").not.toContain("##");
    await assertClean(page, w, "a markdown post in the visual editor");

    await page.request.delete(`/api/admin/blog/?id=${post.id}`);
  });
});

test.describe("blog — the sample posts", () => {
  test.use({ extraHTTPHeaders: ipHeaders(172) });

  const SLUGS = ["uhod-za-borodoy-zimoy", "kak-vybrat-shampun-po-tipu-kozhi-golovy", "pasta-vosk-ili-glina"];

  test("the three seeded articles are listed and readable in all three languages", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);

    for (const { code, seg } of LANGS) {
      const feed = await page.request.get(`/api/blog/?lang=${code}&page=1`);
      expect(feed.status(), `the blog feed is down for ${code}`).toBe(200);
      const posts = (await feed.json()).posts as Array<{ slug: string; title: string; excerpt: string; coverUrl: string }>;
      for (const slug of SLUGS) {
        const p = posts.find((x) => x.slug === slug);
        expect(p, `${slug} is missing from the ${code} feed`).toBeTruthy();
        expect(p!.title.length, `${slug} has no ${code} title`).toBeGreaterThan(10);
        expect(p!.excerpt.length, `${slug} has no ${code} excerpt`).toBeGreaterThan(20);
        expect(p!.coverUrl, `${slug} has no cover`).toMatch(/^\/shop\/img\//);
      }

      await page.goto(shopUrl(seg, "/blog/"));
      await waitForScreen(page, "blog");
      const tiles = page.locator(".blog__tile");
      await expect(tiles.first()).toBeVisible();
      expect(await tiles.count(), `the ${code} blog listing is short`).toBeGreaterThanOrEqual(3);
      await assertClean(page, w, `blog listing (${code})`);
    }
  });

  test("a sample article shows its cover, its headings, its inline product card and its two products", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await page.goto(shopUrl("", `/blog/${SLUGS[0]}/`));
    await waitForScreen(page, "blogpost");

    await expect(page.locator(".blog__cover")).toBeVisible();
    const article = page.locator(".blog__body");
    expect(await article.locator("h2").count(), "the sample article has no sections").toBeGreaterThanOrEqual(3);
    expect(await article.locator("ul li").count()).toBeGreaterThanOrEqual(4);
    await expect(article.locator(".blog__prod").first(), "no inline product card").toBeVisible();
    // «Товары из статьи» — the two products the post links
    expect(await page.locator(".card__go").count(), "the two linked products are not under the article").toBeGreaterThanOrEqual(2);
    await assertClean(page, w, "a sample article");

    // and on a phone the article is still one column, nothing spilling sideways
    await page.setViewportSize({ width: 375, height: 780 });
    await expect(article.locator("h2").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the article scrolls sideways on a 375 px screen").toBeLessThanOrEqual(1);
    await assertClean(page, w, "a sample article on a phone");
  });
});
