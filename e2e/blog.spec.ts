import { expect, test, type Page } from "@playwright/test";
import { ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";

/** The storefront blog — the listing and one article — as the owner reads
 *  them: tiles that read as links, an article page laid out like every other
 *  page, product cards under it that are as wide as on a category page, and
 *  a list that paints from what the tab already knows instead of waiting for
 *  the database (docs/blog.md, the "blog" block in public/shop2/app.js).
 *
 *  Runs on `--project=desktop` AND `--project=mobile` (docs/testing.md): the
 *  article page has a phone layout of its own, and the timing test is about
 *  a cold database, which a phone feels most. The e2e prerender has no
 *  database (tools/e2e-build.mjs runs it without DATABASE_URL), so nothing is
 *  embedded in the pages here — what is proven is the idle prefetch and the
 *  tab's own copy (sessionStorage); the embedded #blogdata is the same data
 *  through the same hydrateBlog() and is covered by the prerender itself. */
test.use({ extraHTTPHeaders: ipHeaders(81) });

/** Migration 071_blog_samples.sql — three published posts in all three
 *  languages. The first links two products, one of them out of stock, so
 *  «Товары из статьи» renders both kinds of foot row («В корзину» and
 *  «Сообщить о наличии»). */
const SLUGS = ["uhod-za-borodoy-zimoy", "kak-vybrat-shampun-po-tipu-kozhi-golovy", "pasta-vosk-ili-glina"];

async function cursorOf(page: Page, selector: string): Promise<string> {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  return el.evaluate((node) => getComputedStyle(node).cursor);
}

test.describe("blog — tiles read as links", () => {
  test("a listing tile, an inline product row and an «other articles» tile all show the pointer", async ({ page }) => {
    await page.goto(shopUrl("", "/blog/"));
    await waitForScreen(page, "blog");
    // a real link (Ctrl-click opens a tab, the keyboard reaches it) — and the pointer says so
    await expect(page.locator(".blog__tile").first()).toHaveAttribute("href", /\/shop2\/blog\/[^/]+\/$/);
    expect(await cursorOf(page, ".blog__tile")).toBe("pointer");

    await page.locator(`.blog__tile[data-go-blog="${SLUGS[0]}"]`).click();
    await waitForScreen(page, "blogpost");
    // «Другие статьи» is the last thing to land (the list after the post) —
    // once it is there nothing repaints under the measurements below
    await expect(page.locator(".blog__shelf .blog__tile").first()).toBeVisible();
    expect(await cursorOf(page, ".blog__body .blog__prod")).toBe("pointer");
    // «Другие статьи» — the same tiles, the same pointer
    expect(await cursorOf(page, ".blog__shelf .blog__tile")).toBe("pointer");
  });
});

for (const lang of LANGS) {
  test(`an article's breadcrumbs start where the listing's do — ${lang.code}`, async ({ page }) => {
    // the listing keeps its crumbs in the ordinary .wrap, like every page
    await page.goto(shopUrl(lang.seg, "/blog/"));
    await waitForScreen(page, "blog");
    // measure only once the real tiles are in: the cold skeleton → list
    // repaint replaces <main>, and a node measured across that swap is a
    // detached one (NaN geometry)
    await expect(page.locator(".blog__tile").first()).toBeVisible();
    const listCrumbs = await page.locator("main .crumbs").boundingBox();
    const wrapEdge = await page.locator("main .wrap").first().evaluate((el) => {
      return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
    });
    expect(listCrumbs, "no breadcrumbs on the listing").not.toBeNull();
    expect(Math.abs(listCrumbs!.x - wrapEdge)).toBeLessThanOrEqual(1);

    await page.locator(`.blog__tile[data-go-blog="${SLUGS[0]}"]`).click();
    await waitForScreen(page, "blogpost");
    // the article and, below it, the «other articles» shelf — the last
    // thing that can still repaint the page (the list landing after the post)
    await expect(page.locator(".blog__body:not(.blog__sk) h2").first()).toBeVisible();
    await expect(page.locator(".blog__shelf .blog__tile").first()).toBeVisible();
    const postCrumbs = page.locator("main .crumbs");
    // not squeezed into the reading column any more
    expect(await postCrumbs.evaluate((el) => !!el.closest(".wrap--mid, .blog__read"))).toBe(false);
    const box = await postCrumbs.boundingBox();
    expect(box, "no breadcrumbs on the article").not.toBeNull();
    expect(Math.abs(box!.x - listCrumbs!.x), "the article's crumbs sit elsewhere than the listing's").toBeLessThanOrEqual(1);
    expect(Math.abs(box!.x - wrapEdge)).toBeLessThanOrEqual(1);
    // the article itself is a centred reading column, the shelves under it are not
    const read = await page.locator(".blog__read").boundingBox();
    const shelf = await page.locator(".blog__shelf").first().boundingBox();
    expect(read).not.toBeNull();
    expect(shelf).not.toBeNull();
    expect(shelf!.width).toBeGreaterThanOrEqual(read!.width - 1);
    expect(Math.abs(shelf!.x - listCrumbs!.x)).toBeLessThanOrEqual(1);
  });
}

/* The same geometry check catalogue.spec.ts runs on a category page, on the
 * cards under an article — and, on top of it, the add link's own text: at
 * 2560 px the old 680 px column crammed the cards into two narrow tracks
 * and «Lisa ostukorvi» / «Anna teada, kui on laos» were cut off. Estonian
 * on purpose: its labels are the widest of the three. The text check is a
 * desktop concern — under 480 px the link reads «Lisa korvi», and a phone's
 * 155 px card shows the notify text with the catalogue's own ellipsis. */
test("every card under an article keeps its foot in the card and its add text whole (ET)", async ({ page }) => {
  await page.goto(shopUrl("/et", `/blog/${SLUGS[0]}/`));
  await waitForScreen(page, "blogpost");
  await expect(page.locator(".blog__shelf .card").first()).toBeVisible();

  const report = await page.evaluate(() => {
    const escaped: string[] = [];
    const wide = window.innerWidth >= 768;
    const feet = document.querySelectorAll<HTMLElement>(".blog__shelf [data-cardfoot]");
    feet.forEach((foot) => {
      const card = foot.closest(".card");
      if (!card) { escaped.push(`${foot.dataset.cardfoot}: no .card around the foot row`); return; }
      const s = foot.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (s.right > c.right + 1 || s.left < c.left - 1 || foot.scrollWidth > foot.clientWidth + 1 || s.height > 40) {
        escaped.push(
          `${foot.dataset.cardfoot}: foot ${Math.round(s.left)}…${Math.round(s.right)} h${Math.round(s.height)} sw${foot.scrollWidth}` +
            ` vs card ${Math.round(c.left)}…${Math.round(c.right)}`,
        );
      }
      const add = foot.querySelector<HTMLElement>(".card__add");
      if (!add) { escaped.push(`${foot.dataset.cardfoot}: no add link in the foot`); return; }
      if (wide && add.scrollWidth > add.clientWidth + 1) {
        escaped.push(`${foot.dataset.cardfoot}: «${add.textContent?.trim()}» is clipped (sw${add.scrollWidth} > cw${add.clientWidth})`);
      }
    });
    return {
      escaped,
      count: feet.length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(report.count, "no product cards under the article — the check would be vacuous").toBeGreaterThanOrEqual(2);
  expect(report.escaped, "card foot(s) out of their card, or an add link cut off").toEqual([]);
  expect(report.scrollWidth, "the article page must not scroll sideways").toBeLessThanOrEqual(report.clientWidth + 1);
});

/* The blog must not wait for the database. After boot the SPA asks for the
 * list on idle and then for each article, and keeps them in memory and in
 * sessionStorage; from then on «Блог» and a tile paint from that, and the
 * API is only consulted behind the screen. Proven by making the API slow
 * (4 s — a cold Postgres) once the prefetch has landed, and timing what the
 * shopper sees. */
for (const lang of LANGS) {
  test(`home → Blog paints the articles at once while /api/blog/ takes 4 s — ${lang.code}`, async ({ page }) => {
    test.setTimeout(60_000);
    // the waits are armed before the page loads: the idle prefetch can land
    // before a later waitForResponse would start listening
    const listPrefetched = page.waitForResponse((r) => /\/api\/blog\/\?lang=/.test(r.url()) && r.status() === 200);
    const postsPrefetched = Promise.all(
      SLUGS.map((slug) => page.waitForResponse((r) => r.url().includes(`/api/blog/${slug}/`) && r.status() === 200, { timeout: 30_000 })),
    );
    await page.goto(shopUrl(lang.seg, "/"));
    await waitForScreen(page, "home");
    await listPrefetched;
    await postsPrefetched;

    // from here on the database is "cold"
    await page.route("**/api/blog/**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });

    const t0 = Date.now();
    await page.locator("[data-nav-blog]").click();
    await waitForScreen(page, "blog");
    const tiles = page.locator(".blog__tile");
    await expect(tiles.first()).toBeVisible({ timeout: 2000 });
    expect(await tiles.count()).toBeGreaterThanOrEqual(3);
    expect(Date.now() - t0, "the list waited for the API").toBeLessThan(3500);
    await expect(page.locator(".blog__sk"), "a skeleton was shown although the list was known").toHaveCount(0);

    // a tile the pointer reached (or that was prefetched on idle) opens with its body, not a skeleton
    const t1 = Date.now();
    await page.locator(`.blog__tile[data-go-blog="${SLUGS[0]}"]`).click();
    await waitForScreen(page, "blogpost");
    await expect(page.locator(".blog__body:not(.blog__sk) h2").first()).toBeVisible({ timeout: 2000 });
    expect(Date.now() - t1, "the article waited for the API").toBeLessThan(3500);

    // and a reload of the listing paints from what this tab already holds
    // (sessionStorage), the API still slow: tiles in the very first render
    await page.goto(shopUrl(lang.seg, "/blog/"));
    await waitForScreen(page, "blog");
    await expect(page.locator(".blog__tile").first()).toBeVisible({ timeout: 1500 });
    await expect(page.locator(".blog__sk")).toHaveCount(0);
  });
}
