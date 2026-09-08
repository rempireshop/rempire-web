import { expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./env.mjs";
import { LANGS, PRODUCT, PRODUCT_2, ipHeaders, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

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
    /* On a slow run the toolbar click leaves the caret where Enter does not
       split the heading and the next line lands inside it — put the caret
       back at the end of the heading first, and check the line got its own
       block before formatting it. */
    await box.locator("h2").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Масло каждый день.");
    await expect(box.locator("h2").first(), "the second line was typed into the heading").toHaveText("Подзаголовок раздела");
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

    /* Russian only, so «Опубликовать» asks which reader gets what before it
       does anything — see «blog — publishing with a language still empty»
       below for that question's own test. */
    await page.locator("[data-admblogpublish]").click();
    await page.locator("[data-admblogpublishyes]").click();
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

  /* The Google pair — «Заполнить автоматически» and «все три языка» in the
     «Адрес, автор и текст для Google» block (docs/blog.md). The AI route is
     stubbed: this suite runs with no OPENAI_API_KEY (the real route would
     answer 503), and what is under test is the editor — which language it
     asks for, what it sends, where the answer lands, what the shopper's tab
     then says — not the model. The stub answers in the language it was
     asked for, so a fill in the wrong language cannot pass. */
  test("«Заполнить автоматически» writes the Google pair for the language on the pill, all three on request, and the ET page carries them", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const marker = Date.now().toString().slice(-6);
    const calls: Array<{ lang: string; input: Record<string, unknown> }> = [];
    let failNext = false;
    await page.route("**/api/admin/ai/text/", async (route) => {
      const body = route.request().postDataJSON() as { task: string; lang: string; input: Record<string, unknown> };
      calls.push({ lang: body.lang, input: body.input });
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "bad_input" }) });
      }
      // the first answer takes a moment, so the «…» working state is on screen long enough to be seen
      if (calls.length === 1) await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, text: { title: `${body.lang} Google pealkiri ${marker}`, description: `${body.lang} kirjeldus ${marker}` } }),
      });
    });

    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    await page.locator('[data-blogf="title"]').fill(`Google ${marker}`);
    await page.locator('[data-blogf="excerpt"]').fill("Анонс для сниппета.");
    const box = page.locator("[data-blogbody]");
    await box.click();
    await page.keyboard.type("Зимой борода сохнет — масло вечером, бальзам утром.");
    await page.locator("[data-blogtags]").fill("борода, зима");

    /* Estonian on the pill and an Estonian title; the rest of the article
       exists in Russian only — the request has to carry the Estonian title
       and fall back to the Russian excerpt and text. */
    await page.locator('[data-admbloglang="ET"]').click();
    await page.locator('[data-blogf="title"]').fill(`Habe ${marker}`);
    await page.locator("[data-blogmore]").click();
    const seoTitle = page.locator('[data-blogf="seoTitle"]');
    const seoDesc = page.locator('[data-blogf="seoDesc"]');
    await expect(seoTitle).toBeVisible();
    const gen = page.locator("[data-admblogseogen]");
    await expect(gen).toHaveText("Заполнить автоматически");

    await gen.click();
    await expect(gen, "no working state while the model answers").toHaveText("…");
    await expect(seoTitle).toHaveValue(`ET Google pealkiri ${marker}`);
    await expect(seoDesc).toHaveValue(`ET kirjeldus ${marker}`);
    await expect(page.locator('[data-blogcount="seoTitle"]')).toHaveText(`${`ET Google pealkiri ${marker}`.length}/70`);
    await expect(page.locator('[data-blogcount="seoDesc"]')).toHaveText(`${`ET kirjeldus ${marker}`.length}/170`);
    await expect(gen).toHaveText("Заполнить автоматически");
    expect(calls, "one request for the one language on the pill").toHaveLength(1);
    expect(calls[0].lang).toBe("ET");
    expect(calls[0].input.kind).toBe("post");
    expect(calls[0].input.title).toBe(`Habe ${marker}`);
    expect(calls[0].input.excerpt).toBe("Анонс для сниппета.");
    expect(String(calls[0].input.body)).toContain("масло вечером");
    expect(calls[0].input.tags).toEqual(["борода", "зима"]);
    await clearToast(page);

    /* «все три языка»: three requests, one per language; the pill's own
       pair stays on screen, the other two wait behind their pills — and the
       block stays open across the switch. */
    await page.locator("[data-admblogseoall]").click();
    await expect.poll(() => calls.length, "three requests, one per language").toBe(4);
    expect(calls.slice(1).map((c) => c.lang).sort()).toEqual(["EN", "ET", "RU"]);
    for (const c of calls.slice(1)) expect(c.input.kind).toBe("post");
    await expect(seoTitle).toHaveValue(`ET Google pealkiri ${marker}`);
    await clearToast(page);
    await page.locator('[data-admbloglang="RU"]').click();
    await expect(seoTitle, "the Google block folded shut on the language switch").toBeVisible();
    await expect(seoTitle).toHaveValue(`RU Google pealkiri ${marker}`);
    await expect(seoDesc).toHaveValue(`RU kirjeldus ${marker}`);
    await page.locator('[data-admbloglang="EN"]').click();
    await expect(seoTitle).toHaveValue(`EN Google pealkiri ${marker}`);

    /* A refusal is a plain-Russian toast; the boxes keep what they had and
       the button gets its label back. Chromium logs the 400 as a console
       error of its own — the toast is the assertion that matters. */
    failNext = true;
    w.allow.push(/\/api\/admin\/ai\/text\//);
    await gen.click();
    expect(await toastText(page)).toContain("Не получилось — попробуйте ещё раз");
    await expect(seoTitle).toHaveValue(`EN Google pealkiri ${marker}`);
    await expect(gen).toHaveText("Заполнить автоматически");
    await clearToast(page);
    await assertClean(page, w, "Google block filled in");

    /* The save round trip: all three pairs reach the post, and come back
       into the editor under their pills. A Google pair is not an article, so
       the Estonian and English texts are still empty here and «Опубликовать»
       asks about them first. */
    await page.locator("[data-admblogpublish]").click();
    await page.locator("[data-admblogpublishyes]").click();
    await clearToast(page);
    await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();
    const slug = await page.locator("[data-blogslug]").inputValue();
    const saved = await page.request.get(`/api/admin/blog/?slug=${slug}`);
    expect(saved.status()).toBe(200);
    const post = (await saved.json()).post as { id: string; seoTitle: Record<string, string>; seoDesc: Record<string, string> };
    expect(post.seoTitle).toEqual({ RU: `RU Google pealkiri ${marker}`, ET: `ET Google pealkiri ${marker}`, EN: `EN Google pealkiri ${marker}` });
    expect(post.seoDesc).toEqual({ RU: `RU kirjeldus ${marker}`, ET: `ET kirjeldus ${marker}`, EN: `EN kirjeldus ${marker}` });
    await page.locator("[data-admblogback]").click();
    await page.locator(`[data-admblogedit="${post.id}"]`).click();
    await page.locator('[data-admbloglang="ET"]').click();
    await expect(page.locator('[data-blogf="seoTitle"]')).toHaveValue(`ET Google pealkiri ${marker}`);
    await expect(page.locator('[data-blogf="seoDesc"]')).toHaveValue(`ET kirjeldus ${marker}`);

    /* What Google (and the tab) gets on the Estonian page, from a context of
       its own: the ET pair, not the title and the excerpt. */
    const shop = await freshShop(browser);
    await shop.page.goto(shopUrl("/et", `/blog/${slug}/`));
    await waitForScreen(shop.page, "blogpost");
    await expect(shop.page.locator(".blog__body:not(.blog__sk)")).toBeVisible();
    await expect(shop.page).toHaveTitle(`ET Google pealkiri ${marker} — REMPIRE`);
    await expect(shop.page.locator('meta[name="description"]')).toHaveAttribute("content", `ET kirjeldus ${marker}`);
    await expect(shop.page.locator('meta[property="og:title"]')).toHaveAttribute("content", `ET Google pealkiri ${marker} — REMPIRE`);
    await assertClean(shop.page, shop.w, "the Estonian article page");
    await shop.close();

    // back to the drafts: this suite leaves the blog as it found it
    await page.locator("[data-admblogunpublish]").click();
    await clearToast(page);
    await assertClean(page, w, "Google pair test cleaned up");
  });

  /* A post published after the last build has no static page — until now the
     /shop2/:path+ fallback handed a crawler the Russian home page. The page
     is built from the row at request time (src/lib/blog-page.ts): what the
     server sends before any script runs is what is asserted first, then what
     the tab shows once app.js has taken over, the sitemap the app serves,
     and the 404 once the post is taken down. The suite's own prerender runs
     with no database, so every post here is «published after the build». */
  test("a post published after the build is a real page for a crawler: the ET head from the row, the card, the sitemap, 404 once unpublished", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const marker = Date.now().toString().slice(-6);
    await openAdmin(page);
    const created = await page.request.post("/api/admin/blog/", {
      data: {
        title: { RU: `Статья после сборки ${marker}`, ET: `Artikkel pärast ehitust ${marker}`, EN: "" },
        excerpt: { RU: "Анонс.", ET: "Lühikokkuvõte." },
        body: { RU: "## Раздел\n\nТекст **жирный**.", ET: "## Osa\n\nTekst **paks**." },
        seoTitle: { RU: `Google RU ${marker}`, ET: `Google ET ${marker}` },
        seoDesc: { RU: `Kirjeldus RU ${marker}`, ET: `Kirjeldus ET ${marker}` },
        coverUrl: IMAGE_URL,
        products: [PRODUCT.id],
      },
    });
    expect(created.status()).toBe(200);
    const post = (await created.json()).post as { id: string; slug: string };
    try {
      expect((await page.request.patch("/api/admin/blog/", { data: { id: post.id, publish: true } })).status()).toBe(200);

      // ---- a fresh, logged-out visitor's Estonian page, as the server sent it ----
      const shop = await freshShop(browser);
      const res = await shop.page.goto(shopUrl("/et", `/blog/${post.slug}/`));
      expect(res?.status()).toBe(200);
      const served = (await res!.text()).replace(/\r\n?/g, "\n");
      expect(served).toMatch(/^<!doctype html>\n<html lang="et">/);
      expect(served).toContain(`<title>Google ET ${marker} — REMPIRE</title>`);
      expect(served).toContain(`<meta name="description" content="Kirjeldus ET ${marker}">`);
      expect(served).toContain(`<link rel="canonical" href="${E2E_BASE_URL}/shop2/et/blog/${post.slug}/" data-seo="canonical">`);
      expect(served).toContain(`<link rel="alternate" hreflang="x-default" href="${E2E_BASE_URL}/shop2/blog/${post.slug}/" data-seo="alt-x">`);
      expect(served).toContain('<meta property="og:type" content="article">');
      expect(served).toContain('<meta property="og:locale" content="et_EE"');
      expect(served).toContain(`<meta property="og:image" content="${E2E_BASE_URL}/shop2/og/blog-${post.slug}.et.png?v=`);
      expect(served).toContain('"@type":"BlogPosting"');
      expect(served).toContain(`<h1 class="display h1">Artikkel pärast ehitust ${marker}</h1>`);
      expect(served).toContain("<h2>Osa</h2><p>Tekst <strong>paks</strong>.</p>");
      expect(served).toContain(`href="/shop2/et/p/${PRODUCT.id}/"`);
      expect(served).toContain('<script type="application/json" id="blogpost">');
      // …and what the tab shows once app.js has taken over: the same head, the real article
      await waitForScreen(shop.page, "blogpost");
      await expect(shop.page.locator(".blog__body:not(.blog__sk) h2")).toHaveText("Osa");
      await expect(shop.page).toHaveTitle(`Google ET ${marker} — REMPIRE`);
      await expect(shop.page.locator('meta[name="description"]')).toHaveAttribute("content", `Kirjeldus ET ${marker}`);
      await expect(shop.page.locator('link[rel="alternate"][hreflang]')).toHaveCount(4);
      await assertClean(shop.page, shop.w, "the Estonian page of a post published after the build");
      await shop.close();

      // the card the scrapers are pointed at is a real 1 200×630 PNG
      const card = await page.request.get(`/shop2/og/blog-${post.slug}.et.png`);
      expect(card.status(), "the blog card did not render").toBe(200);
      expect(card.headers()["content-type"]).toBe("image/png");
      expect((await card.body()).length).toBeGreaterThan(1000);

      // the sitemap the app serves names it, in three languages
      const xml = await (await page.request.get("/sitemap-custom.xml")).text();
      for (const seg of ["", "/et", "/en"]) expect(xml, seg || "ru").toContain(`<loc>${E2E_BASE_URL}/shop2${seg}/blog/${post.slug}/</loc>`);

      // taken down: 404 with noindex, gone from the sitemap, the browser still lands home
      expect((await page.request.patch("/api/admin/blog/", { data: { id: post.id, publish: false } })).status()).toBe(200);
      for (const seg of ["", "/et", "/en"]) {
        const gone = await page.request.get(shopUrl(seg, `/blog/${post.slug}/`));
        expect(gone.status(), seg || "ru").toBe(404);
        expect(await gone.text()).toContain('<meta name="robots" content="noindex, nofollow">');
      }
      expect(await (await page.request.get("/sitemap-custom.xml")).text()).not.toContain(post.slug);
      expect((await page.request.get(`/shop2/og/blog-${post.slug}.png`)).status()).toBe(404);
      await assertClean(page, w, "post published after the build");
    } finally {
      await page.request.delete(`/api/admin/blog/?id=${post.id}`);
    }
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

/* ---- the whole article ------------------------------------------------------
   «Написать статью целиком» in the editor's assistant card, and the same job
   started from the floating assistant's «напиши статью…». The article
   generator (POST /api/admin/ai/text/, tasks post_full and post_translate)
   is stubbed — this suite has no OPENAI_API_KEY — and answers in the
   language it was asked for, so a field filled in the wrong language cannot
   pass. What is under test is the editor: three calls in order, every field
   of every language filled, the draft saved by itself, the failure line, and
   the published Estonian page carrying the Estonian article. */
type AiCall = { task: string; lang: string; input: Record<string, unknown> };

function articleFor(lang: string, marker: string) {
  if (lang === "ET") {
    return {
      title: `Habeme talvine hooldus ${marker}`, excerpt: "Kolm harjumust külmaks hooajaks.",
      body: `<p>Talvel habe kuivab.</p><h2>Õli igal õhtul ${marker}</h2><p>Tilk pärast pesu.</p><ul><li>tilk</li><li>kaks</li></ul>`,
      tags: ["habe", "talv"], seo: { title: `ET Google ${marker}`, description: `ET kirjeldus ${marker}` },
    };
  }
  if (lang === "EN") {
    return {
      title: `Winter beard care ${marker}`, excerpt: "Three habits for the cold season.",
      body: `<p>A beard dries out in winter.</p><h2>Oil every evening ${marker}</h2><p>A drop after washing.</p><ul><li>one drop</li><li>two</li></ul>`,
      tags: ["beard", "winter"], seo: { title: `EN Google ${marker}`, description: `EN description ${marker}` },
    };
  }
  return {
    title: `Уход за бородой зимой ${marker}`, excerpt: "Три привычки на холодный сезон.",
    body: `<p>Зимой борода сохнет.</p><h2>Масло каждый вечер ${marker}</h2><p>Капля после умывания.</p><ul><li>капля</li><li>две</li></ul>`,
    tags: ["борода", "зима", "уход"], seo: { title: `RU Google ${marker}`, description: `RU описание ${marker}` },
    products: [PRODUCT.id],
  };
}

/** The generator, stubbed per task. `failFirst` makes the first call answer 429 — the editor's failure path. */
async function stubArticle(page: Page, marker: string, opts: { failFirst?: boolean } = {}): Promise<AiCall[]> {
  const calls: AiCall[] = [];
  let fail = !!opts.failFirst;
  await page.route("**/api/admin/ai/text/", async (route) => {
    const body = route.request().postDataJSON() as AiCall;
    calls.push({ task: body.task, lang: body.lang, input: body.input });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, error: "rate_limited" }) });
    }
    // the first call takes a moment, so the «…» / «Пишу по-русски…» state is on screen long enough to be seen
    if (body.task === "post_full") await new Promise((r) => setTimeout(r, 600));
    const lang = body.task === "post_full" ? "RU" : body.lang;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, text: articleFor(lang, marker) }) });
  });
  return calls;
}

test.describe("blog — the whole article", () => {
  test.use({ extraHTTPHeaders: ipHeaders(175) });

  test("«Написать статью целиком» fills every field in three languages, saves the draft, and the ET page carries the ET article", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const marker = Date.now().toString().slice(-6);
    const calls = await stubArticle(page, marker, { failFirst: true });
    let postId = "";

    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const full = page.locator("[data-admblogfull]");
    await expect(full).toHaveText("Написать статью целиком");
    await page.locator("[data-admblogtopic]").fill("уход за бородой зимой");

    /* ---- the failure path first: a plain sentence under the button, nothing half-filled ---- */
    w.allow.push(/\/api\/admin\/ai\/text\//);   // Chromium logs the 429 as a console error of its own
    await full.click();
    const progress = page.locator("[data-admblogprogress]");
    await expect(progress).toHaveText("Слишком много запросов — попробуйте позже");
    await expect(full).toHaveText("Написать статью целиком");
    await expect(page.locator('[data-blogf="title"]')).toHaveValue("");
    await clearToast(page);
    expect(calls).toHaveLength(1);

    /* ---- the whole job: Russian, then Estonian, then English, then saved ---- */
    await full.click();
    await expect(full, "no working state while the article is written").toHaveText("…");
    await expect(progress).toHaveText("Пишу по-русски…");
    await expect(page.getByRole("status").first()).toContainText("Статья готова на трёх языках", { timeout: 30_000 });
    await clearToast(page);
    await expect(progress).toBeHidden();
    await expect(full).toHaveText("Написать статью целиком");

    // three calls, in order, each in its own language — the translations carry the Russian article and the product names
    expect(calls.slice(1).map((c) => `${c.task}:${c.lang}`)).toEqual(["post_full:RU", "post_translate:ET", "post_translate:EN"]);
    expect(calls[1].input.topic).toBe("уход за бородой зимой");
    expect(String(calls[2].input.body)).toContain(`<h2>Масло каждый вечер ${marker}</h2>`);
    expect(calls[2].input.sourceLang).toBe("RU");
    expect(calls[2].input.keepNames).toEqual([`${PRODUCT.brand} Bio Botanical Shampoo — шампунь`]);
    expect(calls[2].input.seoTitle).toBe(`RU Google ${marker}`);

    // every field, every language
    const box = page.locator("[data-blogbody]");
    await expect(page.locator('[data-blogf="title"]')).toHaveValue(`Уход за бородой зимой ${marker}`);
    await expect(page.locator('[data-blogf="excerpt"]')).toHaveValue("Три привычки на холодный сезон.");
    await expect(box.locator("h2")).toHaveText(`Масло каждый вечер ${marker}`);
    await expect(box.locator("ul li")).toHaveCount(2);
    await expect(page.locator("[data-blogtags]")).toHaveValue("борода, зима, уход");
    await expect(page.locator(`[data-admblogproductdel="${PRODUCT.id}"]`), "the product the article mentions is not picked").toBeVisible();
    const slug = await page.locator("[data-blogslug]").inputValue();
    expect(slug).toMatch(new RegExp(`^uhod-za-borodoy-zimoy-${marker}`));
    await page.locator("[data-blogmore]").click();
    await expect(page.locator('[data-blogf="seoTitle"]')).toHaveValue(`RU Google ${marker}`);
    await expect(page.locator('[data-blogf="seoDesc"]')).toHaveValue(`RU описание ${marker}`);
    await page.locator('[data-admbloglang="ET"]').click();
    await expect(page.locator('[data-blogf="title"]')).toHaveValue(`Habeme talvine hooldus ${marker}`);
    await expect(box.locator("h2")).toHaveText(`Õli igal õhtul ${marker}`);
    await expect(page.locator('[data-blogf="seoTitle"]')).toHaveValue(`ET Google ${marker}`);
    await page.locator('[data-admbloglang="EN"]').click();
    await expect(page.locator('[data-blogf="title"]')).toHaveValue(`Winter beard care ${marker}`);
    await expect(box.locator("h2")).toHaveText(`Oil every evening ${marker}`);
    await expect(page.locator('[data-blogf="seoDesc"]')).toHaveValue(`EN description ${marker}`);
    await assertClean(page, w, "the whole article in the editor");

    // saved by itself, as a draft — the owner has not pressed anything yet
    const saved = await page.request.get(`/api/admin/blog/?slug=${slug}`);
    expect(saved.status(), "the article was not saved as a draft").toBe(200);
    const post = (await saved.json()).post as { id: string; status: string; title: Record<string, string>; body: Record<string, string>; tags: string[]; products: string[]; seoTitle: Record<string, string> };
    postId = post.id;
    try {
      expect(post.status).toBe("draft");
      expect(post.title).toEqual({ RU: `Уход за бородой зимой ${marker}`, ET: `Habeme talvine hooldus ${marker}`, EN: `Winter beard care ${marker}` });
      expect(post.body.ET).toContain(`<h2>Õli igal õhtul ${marker}</h2>`);
      expect(post.tags).toEqual(["борода", "зима", "уход"]);
      expect(post.products).toEqual([PRODUCT.id]);
      expect(post.seoTitle.EN).toBe(`EN Google ${marker}`);

      /* ---- the owner reads and publishes; the Estonian page is the Estonian article ---- */
      await page.locator("[data-admblogpublish]").click();
      await clearToast(page);
      await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("/et", `/blog/${slug}/`));
      await waitForScreen(shop.page, "blogpost");
      const article = shop.page.locator(".blog__body:not(.blog__sk)");
      await expect(article.locator("h2")).toHaveText(`Õli igal õhtul ${marker}`);
      await expect(article.locator("ul li")).toHaveCount(2);
      await expect(shop.page.locator("h1")).toContainText(`Habeme talvine hooldus ${marker}`);
      await expect(shop.page).toHaveTitle(`ET Google ${marker} — REMPIRE`);
      await expect(shop.page.locator('meta[name="description"]')).toHaveAttribute("content", `ET kirjeldus ${marker}`);
      // «Товары из статьи»: the product the generator named is under the article
      await expect(shop.page.locator(`.card__go[data-go-product="${PRODUCT.id}"], [data-go-product="${PRODUCT.id}"]`).first()).toBeVisible();
      await assertClean(shop.page, shop.w, "the Estonian page of the generated article");
      await shop.close();
    } finally {
      // this suite leaves the blog as it found it
      if (postId) await page.request.delete(`/api/admin/blog/?id=${postId}`);
    }
  });

  test("the floating assistant's «напиши статью…» names a topic, and the same generator writes it in the editor", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const marker = Date.now().toString().slice(-6);
    const calls = await stubArticle(page, marker);
    const asked: Array<Record<string, unknown>> = [];
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
      }
      asked.push(route.request().postDataJSON() as Record<string, unknown>);
      // what the route answers now: a topic, never the article (src/app/api/assistant/route.ts)
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          reply: "Напишу статью целиком про уход за бородой зимой — подтвердите, она откроется в редакторе блога.",
          product_ids: [], tab: "blog",
          action: { type: "draft_post", topic: "уход за бородой зимой", lang: "RU", hint: "" },
        }),
      });
    });
    let slug = "";
    await openAdmin(page);
    try {
      await page.locator(".adm-fab[data-admai]").click();
      await page.locator("[data-admq]").fill("у меня новый пост в блоге, напиши мне текст на тему уход за бородой зимой");
      await page.locator("[data-admsend]").click();
      const answer = page.locator("[data-aians]");
      await expect(answer).toContainText("Напишу статью целиком");
      expect((await answer.textContent()) || "", "the panel printed JSON").not.toMatch(/[{}]/);
      const card = answer.locator(".adm-propose");
      await expect(card).toContainText("уход за бородой зимой");
      await card.locator("[data-admapply]").click();

      // the editor opens on a new draft with the topic in the box, and the article fills in
      await expect(page.locator("[data-blogbody]")).toBeVisible();
      await expect(page.locator("[data-admblogtopic]")).toHaveValue("уход за бородой зимой");
      await expect(page.locator("[data-admblogfull]")).toHaveText("…");
      await expect(page.getByRole("status").first()).toContainText("Статья готова на трёх языках", { timeout: 30_000 });
      await clearToast(page);
      await expect(page.locator('[data-blogf="title"]')).toHaveValue(`Уход за бородой зимой ${marker}`);
      await expect(page.locator("[data-blogbody] h2")).toHaveText(`Масло каждый вечер ${marker}`);
      slug = await page.locator("[data-blogslug]").inputValue();
      expect(calls.map((c) => `${c.task}:${c.lang}`)).toEqual(["post_full:RU", "post_translate:ET", "post_translate:EN"]);
      expect(asked[0].mode).toBe("admin");
      const saved = await page.request.get(`/api/admin/blog/?slug=${slug}`);
      expect(saved.status(), "the assistant's article was not saved as a draft").toBe(200);
      expect(((await saved.json()).post as { status: string }).status).toBe("draft");
      await assertClean(page, w, "the assistant's article in the editor");
    } finally {
      if (slug) {
        const row = await page.request.get(`/api/admin/blog/?slug=${slug}`);
        if (row.status() === 200) await page.request.delete(`/api/admin/blog/?id=${((await row.json()).post as { id: string }).id}`);
      }
    }
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
    /* The real body, not the skeleton: since the blog paints from its cached
       summary first, `.blog__body` matches the `aria-busy` placeholder too, and
       `waitForScreen` + a visible cover are both true while that placeholder is
       still what is on screen. `count()` does not auto-wait, so the first
       assertion has to be one that does. */
    const article = page.locator(".blog__body:not(.blog__sk)");
    await expect(article.locator("h2").first(), "the sample article never painted").toBeVisible();
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

/**
 * The language trap, and the answer to it.
 *
 * What happened once: the owner put a product card into the **Russian** body
 * of «Почему зудит борода», then pressed the strip's «English» — three words
 * shaped exactly like the panel's own RU · ET · EN switch in the sidebar —
 * got the English body, which of course had no card in it, and read that as
 * «my edit did not save». Nothing was broken; the editor simply never said
 * which of three texts was on screen (docs/audit/2026-09-07-blog-language.md).
 *
 * So these tests hold the editor to saying it: the strip is labelled, each
 * tab carries the state of its own version, the insert names the language it
 * landed in, switching keeps every unsaved word, and leaving asks first.
 */
const langState = (page: Page, attr: string, code: string) =>
  page.locator(`[${attr}="${code}"] [data-langst]`);

test.describe("blog — which language am I writing", () => {
  test.use({ extraHTTPHeaders: ipHeaders(215) });

  test("the strip says it is the post's language, each tab says what that version holds, and a product row names the text it went into", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const st = (code: string) => langState(page, "data-admbloglang", code);
    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box).toBeVisible();

    // the strip names itself — it used to be three bare words and an aria-label
    await expect(page.locator(".adm-langbar__l").first()).toHaveText("Язык статьи");
    await expect(page.locator(".adm-langbar__n").first(), "the strip never says it is not the panel's language")
      .toContainText("а не язык панели");

    // an untouched post: three empty versions
    for (const code of ["RU", "ET", "EN"]) await expect(st(code)).toHaveText("пусто");

    await page.locator('[data-blogf="title"]').fill("Почему зудит борода");
    await box.click();
    await page.keyboard.type("Русский текст статьи.");
    await expect(st("RU"), "the tab still calls a written Russian version empty").toContainText("готово");
    await expect(st("RU")).toContainText("без товаров");
    await expect(st("ET")).toHaveText("пусто");

    // the English version, written the way the translator writes it
    await page.locator('[data-admbloglang="EN"]').click();
    await page.locator('[data-blogf="title"]').fill("Why a beard itches");
    await box.click();
    await page.keyboard.type("English body of the article.");
    await page.locator('[data-admbloglang="RU"]').click();

    /* ---- the insert that started all this ------------------------------- */
    await box.click();
    await page.keyboard.press("End");
    await page.locator('[data-blogrt="product"]').click();
    await page.locator("[data-blogtoolq]").fill(PRODUCT.id);
    await page.locator(`[data-blogtoolpick="${PRODUCT.id}"]`).click();
    await expect(box.locator(`a[data-product="${PRODUCT.id}"]`)).toBeVisible();
    expect(await toastText(page), "the insert never said which language it went into")
      .toContain("русский текст статьи");
    await clearToast(page);

    // …and from now on the strip carries the answer, on every tab
    await expect(st("RU")).toContainText("с товарами");
    await expect(st("EN"), "the English version claims a product card it does not have")
      .toContainText("без товаров");

    // pressing «English» is still the same click — it just cannot mislead now
    await page.locator('[data-admbloglang="EN"]').click();
    expect(await box.locator("a[data-product]").count(), "the English body has a card in it").toBe(0);
    await expect(page.locator(".adm-langbar__n").first()).toContainText("английскую версию");
    await expect(st("RU"), "the Russian version's card is not visible from the English tab")
      .toContainText("с товарами");

    await assertClean(page, w, "the blog editor's language strip");
  });

  test("switching language keeps every unsaved word, and leaving without saving asks first", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box).toBeVisible();
    const dirty = page.locator("[data-blogdirty]");
    await expect(dirty, "a post nobody has touched says it has unsaved changes").toBeHidden();

    await page.locator('[data-blogf="title"]').fill("Черновик о бороде");
    await box.click();
    await page.keyboard.type("Первый абзац по-русски.");
    await expect(dirty, "typing into the body never says it is unsaved").toBeVisible();

    // ET and back — nothing typed is lost, and it still says so
    await page.locator('[data-admbloglang="ET"]').click();
    await expect(box).toHaveText("");
    await page.locator('[data-admbloglang="RU"]').click();
    await expect(box, "switching language lost the unsaved Russian text").toContainText("Первый абзац по-русски.");
    await expect(page.locator('[data-blogf="title"]')).toHaveValue("Черновик о бороде");
    await expect(dirty).toBeVisible();

    /* ---- leaving, which really does drop it ------------------------------ */
    await page.locator("[data-admblogback]").click();
    await expect(page.locator("[data-admblogbackyes]"), "the editor let unsaved work go without a word").toBeVisible();
    await page.locator("[data-admblogbackno]").click();
    await expect(box, "«Остаться» threw the text away anyway").toContainText("Первый абзац по-русски.");

    await page.locator("[data-admblogsave]").click();
    await expect(dirty, "a saved post still says it has unsaved changes").toBeHidden();
    await clearToast(page);
    // …and now the door is open again, no question asked
    await page.locator("[data-admblogback]").click();
    await expect(page.locator("[data-admblognew]")).toBeVisible();

    await assertClean(page, w, "unsaved blog work");
  });

  test("the panel's own language changes the panel, never which body is being edited", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const st = (code: string) => langState(page, "data-admbloglang", code);
    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box).toBeVisible();
    await page.locator('[data-blogf="title"]').fill("Про бороду");
    await box.click();
    await page.keyboard.type("Русский текст.");

    await page.locator('.adm-side [data-lang="EN"]').click();
    await expect(page.locator(".adm-langbar__l").first(), "the strip's label did not follow the panel")
      .toHaveText("Post language");
    // the tab names are endonyms — a language names itself in any panel
    await expect(page.locator('[data-admbloglang="RU"] .adm-seg__nm')).toHaveText("Русский");
    await expect(page.locator('[data-admbloglang="RU"]'), "the panel's language moved the post's language")
      .toHaveAttribute("aria-current", "true");
    await expect(box, "an English panel swapped the body under the owner").toContainText("Русский текст.");
    await expect(st("RU")).toContainText("ready");
    await expect(page.locator(".adm-langbar__n").first()).toContainText("You are editing the Russian version");

    await page.locator('.adm-side [data-lang="RU"]').click();
    await assertClean(page, w, "the blog editor on an English panel");
  });

  test("the letters editor opens on Russian even when the panel is in English, and says what the other two hold", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await page.locator('.adm-side [data-lang="EN"]').click();
    await tab(page, "mail");
    await page.locator("[data-mailtpl]").first().click();
    await expect(page.locator('[data-maillang="RU"]'), "an English panel picked the English letter to edit")
      .toHaveAttribute("aria-current", "true");
    await expect(page.locator(".adm-langbar__l").first()).toHaveText("Letter language");
    await expect(langState(page, "data-maillang", "ET")).toHaveText("the standard text");
    await page.locator('.adm-side [data-lang="RU"]').click();
    await assertClean(page, w, "the letters editor on an English panel");
  });
});

/**
 * The audit's questions 1 and 2, answered (Dim, 08.09.2026 —
 * docs/audit/2026-09-07-blog-language.md § «Вопросы к Диму»).
 *
 * 1. A post published in Russian only is not a post with two empty pages: the
 *    shop serves the Russian text at the Estonian and English addresses
 *    (pickLang() in src/lib/blog.ts), which is the right thing to do and the
 *    wrong thing to do without telling anybody. Publishing in Russian only is
 *    a legitimate way to work here, so «Опубликовать» asks rather than
 *    refuses — once, at the moment of publishing.
 * 2. A product card put into the Russian body did not survive «Перевести на
 *    ET и EN»: the body goes to the model as text, so the marker went as the
 *    card's own words and came back translated. Now the cards do not make
 *    that trip at all.
 */
test.describe("blog — publishing with a language still empty", () => {
  test.use({ extraHTTPHeaders: ipHeaders(216) });

  test("«Опубликовать» names the empty language and what the reader will see there, and publishes on the second press", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const marker = Date.now().toString().slice(-6);
    const RU_TEXT = `Русский текст статьи про бороду ${marker}.`;
    const ET_TEXT = `Eestikeelne artikli tekst habemest ${marker}.`;
    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box).toBeVisible();
    await page.locator('[data-blogf="title"]').fill(`Только по-русски ${marker}`);
    await box.click();
    await page.keyboard.type(RU_TEXT);

    /* ---- both other languages empty: one question, naming both ---------- */
    await page.locator("[data-admblogpublish]").click();
    const ask = page.getByText("Эстонский и английский тексты статьи пустые");
    await expect(ask, "a Russian-only post was published without a word").toBeVisible();
    await expect(ask, "the question never says what the reader gets instead").toContainText("покупатель увидит русский текст");
    expect(await page.locator("[data-admblogpublish]").count(), "the question and the button it answers are both on screen").toBe(0);
    // asked, not done: the post is still a draft while the question stands
    await expect(page.getByText("Черновик. В магазине его пока не видно.")).toBeVisible();

    // «Отмена» puts the ordinary button back, and nothing was published
    await page.locator("[data-admblogpublishno]").click();
    await expect(page.locator("[data-admblogpublish]")).toBeVisible();
    await expect(page.getByText("Черновик. В магазине его пока не видно.")).toBeVisible();
    await assertClean(page, w, "the publish question");

    /* ---- the Estonian text written, the English one still not ----------- */
    await page.locator('[data-admbloglang="ET"]').click();
    await page.locator('[data-blogf="title"]').fill(`Ainult vene keeles ${marker}`);
    await box.click();
    await page.keyboard.type(ET_TEXT);
    await page.locator('[data-admbloglang="RU"]').click();
    await page.locator("[data-admblogpublish]").click();
    await expect(page.getByText("Английский текст статьи пустой"), "the question did not notice the Estonian text was written").toBeVisible();
    expect(await page.getByText("Эстонский и английский тексты статьи пустые").count()).toBe(0);

    // …and it does not block him: the second press publishes what he wrote
    await page.locator("[data-admblogpublishyes]").click();
    await clearToast(page);
    await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();
    const slug = await page.locator("[data-blogslug]").inputValue();
    const row = await page.request.get(`/api/admin/blog/?slug=${slug}`);
    expect(row.status()).toBe(200);
    const post = (await row.json()).post as { id: string };
    try {
      /* The question told the truth: the English address really does answer
         with the Russian text, and the Estonian one with the Estonian. */
      const en = await page.request.get(`/api/blog/${slug}/?lang=EN`);
      expect(en.status(), "the post was not published after «Опубликовать всё равно»").toBe(200);
      expect((await en.json()).post.bodyHtml, "the English page does not show what the question promised").toContain(RU_TEXT);
      const et = await page.request.get(`/api/blog/${slug}/?lang=ET`);
      expect((await et.json()).post.bodyHtml).toContain(ET_TEXT);

      /* ---- and no question at all once all three are written ------------ */
      await page.locator("[data-admblogunpublish]").click();
      await clearToast(page);
      await page.locator('[data-admbloglang="EN"]').click();
      await page.locator('[data-blogf="title"]').fill(`Russian only ${marker}`);
      await box.click();
      await page.keyboard.type(`The English body of the article ${marker}.`);
      await page.locator("[data-admblogpublish]").click();
      await clearToast(page);
      await expect(page.getByText("Опубликована. Изменения появятся"), "a post written in all three languages was asked about anyway").toBeVisible();
      expect(await page.locator("[data-admblogpublishyes]").count()).toBe(0);
      await assertClean(page, w, "publishing a post written in three languages");
    } finally {
      // this suite leaves the blog as it found it
      await page.request.delete(`/api/admin/blog/?id=${post.id}`);
    }
  });
});

test.describe("blog — the product cards survive a translation", () => {
  test.use({ extraHTTPHeaders: ipHeaders(217) });

  /** The «translate» task, stubbed — this suite has no OPENAI_API_KEY, and
      what is under test is the editor, not the model. The answer is the text
      it was handed under a language prefix, so a card that comes back came
      back through the editor's own hands. `eatMarkers` is the other model,
      the one that flattens whatever it is given and returns no tokens at
      all: it is the reason the cards are not simply trusted to the answer. */
  async function stubTranslate(page: Page, state: { eatMarkers: boolean }): Promise<Array<{ task: string; input: { text: string } }>> {
    const calls: Array<{ task: string; input: { text: string } }> = [];
    await page.route("**/api/admin/ai/text/", async (route) => {
      const body = route.request().postDataJSON() as { task: string; input: { text: string } };
      calls.push(body);
      const say = (l: string) => {
        const answer = `${l} ${body.input.text}`;
        return state.eatMarkers ? answer.replace(/\[\[\d+\]\]/g, "") : answer;
      };
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, texts: { ET: say("ET"), EN: say("EN") } }),
      });
    });
    return calls;
  }

  async function insertCard(page: Page, id: string): Promise<void> {
    await page.locator('[data-blogrt="product"]').click();
    await page.locator("[data-blogtoolq]").fill(id);
    await page.locator(`[data-blogtoolpick="${id}"]`).click();
    await expect(page.locator(`[data-blogbody] a[data-product="${id}"]`)).toBeVisible();
  }

  /** «Перевести на ET и EN» lives inside the «Только часть» disclosure, and
      that is a plain <details>: clicking its summary is a toggle, so opening
      it blind closes it whenever a render has left it open. Press until the
      button is on screen, then press the button. */
  async function translate(page: Page): Promise<void> {
    const btn = page.locator("[data-admblogtranslate]");
    await expect(async () => {
      if (!(await btn.isVisible())) await page.locator("summary", { hasText: "Только часть" }).click();
      await expect(btn).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await btn.click();
    await expect(page.getByRole("status").first()).toContainText("Черновик готов", { timeout: 30_000 });
    await clearToast(page);
  }

  test("«Перевести на ET и EN» carries two cards out of the Russian body into the Estonian one, in their places", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const state = { eatMarkers: false };
    const calls = await stubTranslate(page, state);
    await openAdmin(page);
    await tab(page, "blog");
    await page.locator("[data-admblognew]").click();
    const box = page.locator("[data-blogbody]");
    await expect(box).toBeVisible();
    await page.locator('[data-blogf="title"]').fill(`Две карточки ${Date.now().toString().slice(-6)}`);

    // the Russian body the owner writes: a paragraph and a card, twice
    await box.click();
    await page.keyboard.type("Первый абзац про шампунь.");
    await insertCard(page, PRODUCT.id);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Второй абзац про спрей.");
    await insertCard(page, PRODUCT_2.id);
    await expect(box.locator("a[data-product]")).toHaveCount(2);
    await clearToast(page);

    await translate(page);

    /* What the model was handed: numbered tokens, never the card itself —
       which is how it used to go, as the card's own words, and how it used
       to come back: translated, flattened, no marker left. */
    const bodyCall = calls.find((c) => c.input.text.includes("абзац"));
    expect(bodyCall, "the body was never sent for translation").toBeTruthy();
    expect(bodyCall!.input.text).toContain("[[1]]");
    expect(bodyCall!.input.text).toContain("[[2]]");
    expect(bodyCall!.input.text, "the card still goes to the model as its own words").not.toContain(PRODUCT.brand);

    // …and what came back: both cards, each still in its own paragraph,
    // each pointing at the Estonian page of its product
    await page.locator('[data-admbloglang="ET"]').click();
    const cards = box.locator("a[data-product]");
    await expect(cards, "the Estonian text came back without the product cards").toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("data-product", PRODUCT.id);
    await expect(cards.nth(0)).toHaveAttribute("href", `/shop2/et/p/${PRODUCT.id}/`);
    await expect(cards.nth(1)).toHaveAttribute("data-product", PRODUCT_2.id);
    await expect(langState(page, "data-admbloglang", "ET"), "the Estonian tab still says it has no products").toContainText("с товарами");
    const placed = await box.innerHTML();
    expect(placed.indexOf(PRODUCT.id), "the first card did not stay in the first paragraph")
      .toBeLessThan(placed.indexOf("Второй абзац"));
    await assertClean(page, w, "the translated Estonian body");

    /* ---- the other model: the one that hands the text back with the
       markers gone. The cards are still in the article — at the end of it,
       which is a card in the wrong paragraph, not a card the owner lost. */
    state.eatMarkers = true;
    await page.locator('[data-admbloglang="RU"]').click();
    await translate(page);
    await page.locator('[data-admbloglang="ET"]').click();
    await expect(box.locator("a[data-product]"), "a model that ate the markers ate the cards with them").toHaveCount(2);
    const appended = await box.innerHTML();
    expect(appended, "a leftover token was left in the article as words").not.toContain("[[1]]");
    expect(appended.indexOf(PRODUCT.id)).toBeGreaterThan(appended.indexOf("Второй абзац"));
    await assertClean(page, w, "the translation a flattening model answered");
  });
});
