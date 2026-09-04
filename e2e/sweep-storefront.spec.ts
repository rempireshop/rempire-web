/**
 * Exploratory sweep, part 1 — the crawl.
 *
 * Walks every customer-facing screen of the shop in all three languages and
 * holds each one to the same eight checks (see `auditScreen` in
 * ./sweep-shop-helpers.ts): no uncaught error, no unexpected console.error, no
 * leaked `undefined`/`NaN`/`[object Object]`/`null`/`{{`, no horizontal
 * scroll at phone width, no Cyrillic left in the ET/EN chrome, an `alt` on
 * every `<img>`, no duplicate element ids.
 *
 * Part 2 (the randomised cart/checkout matrix) lives in
 * ./sweep-checkout.spec.ts — split so neither file runs long enough to be
 * awkward to re-run after a fix.
 *
 * Runs on desktop AND mobile (`--project=mobile`), unlike most of this suite:
 * the horizontal-scroll check only means anything at 375px, and a crawl is
 * exactly the kind of test where a viewport-specific layout break hides.
 *
 * Reproducing a failure: every assertion message ends with `seed <N>`. The
 * seed is `SWEEP_SEED` in ./sweep-shop-helpers.ts and nothing else in this file is
 * random.
 */
import { expect, type Page, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { ipHeaders, LANGS, shopUrl } from "./fixtures";
import {
  auditScreen,
  clientNav,
  coldVisit,
  type Ctx,
  expectScreen,
  label,
  makeRng,
  readCatalogue,
  sample,
  SWEEP_SEED,
  warmRoutes,
  watchPage,
  type Watch,
} from "./sweep-shop-helpers";

/* Its own /24 octet so the crawl's own request volume never eats another
   spec's per-IP budget (docs/testing.md "Rate limits and test isolation"). */
test.use({ extraHTTPHeaders: ipHeaders(90) });

/* The 30s default is for a test that does one thing; these walk ~90 screens per language.
   `test.setTimeout` in a file-level beforeEach, not
   `test.describe.configure({timeout})`, because the latter is silently
   ignored when it sits at file scope ahead of the describes. */
test.beforeEach(() => {
  test.setTimeout(180_000);
});

/**
 * One published blog post has to exist for the blog screens to be worth
 * crawling — created through the real admin API, exactly as an owner would
 * (the shop's posts live in the database, not in a generated file).
 *
 * A fixed slug, and existence checked through the *public* route first:
 * Playwright starts a fresh worker after a failing test, which re-runs this
 * hook, and `POST /api/admin/login/` is rate-limited to 5/min per IP
 * (src/lib/auth.ts). Reusing the post the first run made keeps every later
 * hook away from that budget entirely.
 *
 * `title`/`excerpt`/`body` are `{RU,ET,EN}` maps, not plain strings —
 * `trilingual()` in src/lib/blog.ts silently drops anything else, which
 * yields a post with an empty title and the fallback slug "post".
 */
const BLOG_SLUG = "sweep-crawl-fixture";
let blogSlug = "";

test.beforeAll(async ({ browser }) => {
  /* A hook does not inherit the beforeEach timeout above, and this one warms
     a cold `next dev`: ten routes, each compiled on its first hit, and slower
     still while another dev server is rebuilding the shared .next. At the 30s
     default the hook was torn down mid-request ("Target page, context or
     browser has been closed"). */
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(90) });
  const req = ctx.request;

  /* Compile every route the shop touches before a single screen is audited
     — see warmRoutes() for why a `next dev` first-hit compile otherwise
     reads as "the storefront's own probes 404/500". This loosens no
     assertion; it removes a measurement artifact. */
  await warmRoutes(req);

  const already = await req.get(`/api/blog/${BLOG_SLUG}/`);
  if (already.ok()) {
    const body = (await already.json()) as { ok?: boolean; post?: { slug: string } };
    if (body.ok && body.post) blogSlug = body.post.slug;
  }

  if (!blogSlug) {
    const three = (ru: string, et: string, en: string) => ({ RU: ru, ET: et, EN: en });
    const login = await req.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok(), "sweep: admin login for the blog fixture").toBe(true);
    const draft = {
      slug: BLOG_SLUG,
      title: three(
        "Как выбрать шампунь для жирной кожи головы",
        "Kuidas valida šampooni rasusele peanahale",
        "How to choose a shampoo for an oily scalp",
      ),
      excerpt: three(
        "Короткий разбор: на что смотреть в составе.",
        "Lühike ülevaade: millele koostises tähelepanu pöörata.",
        "A short guide: what to look for in the ingredients.",
      ),
      body: three(
        "Жирная кожа головы — это не про «плохой шампунь», а про баланс.",
        "Rasune peanahk ei ole halva šampooni, vaid tasakaalu küsimus.",
        "An oily scalp is not about a bad shampoo — it is about balance.",
      ),
    };
    /* Retried: `next dev` compiles a route on its first hit, and a request
       that lands during that compile (or during a rebuild triggered by
       someone else editing src/** — this repo has more than one agent in it)
       comes back as Next's own "reloading"/"missing required error
       components" HTML page rather than the route's JSON. Nothing to do with
       the shop, and only the fixture is retried — no assertion about the
       storefront is softened by this. */
    let made = await req.post("/api/admin/blog/", { data: draft, timeout: 60_000 });
    for (let attempt = 0; attempt < 12 && !made.ok(); attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      made = await req.post("/api/admin/blog/", { data: draft, timeout: 60_000 });
    }
    expect(made.ok(), `sweep: create the blog fixture post (${await made.text()})`).toBe(true);
    const created = (await made.json()) as { ok: boolean; post: { id: string; slug: string } };
    const pub = await req.patch("/api/admin/blog/", { data: { id: created.post.id, publish: true } });
    expect(pub.ok(), "sweep: publish the blog fixture post").toBe(true);
    blogSlug = created.post.slug;
  }
  await ctx.close();
});

/** Boots one language's home page and returns the watchdog for it. */
async function open(page: Page, seg: string, path: string, screen: string): Promise<Watch> {
  const w = watchPage(page);
  await coldVisit(page, shopUrl(seg, path), screen);
  return w;
}

/** Audit, then forget what was seen, so the next screen starts clean and a
 *  failure names the screen that actually caused it. */
async function check(page: Page, w: Watch, ctx: Ctx): Promise<void> {
  await auditScreen(page, w, ctx);
  w.reset();
}

for (const lang of LANGS) {
  const L = lang.code;

  test.describe(`sweep crawl — ${L}`, () => {
    test("home, every category and every subcategory", async ({ page }) => {
      const w = await open(page, lang.seg, "/", "home");
      await check(page, w, { screen: "home", lang: L });

      const { cats } = await readCatalogue(page);
      for (const cat of ["all", ...cats]) {
        const ctx: Ctx = { screen: `catalog:${cat}`, lang: L };
        await clientNav(page, shopUrl(lang.seg, `/c/${cat}/`));
        await expectScreen(page, "catalog", ctx);
        await check(page, w, ctx);

        // Subcategories are chips on the category screen, not URLs of their
        // own (SUBCATS/subcatsFor in app.js) — and only render where the data
        // can fill them, so most categories have none.
        const chips = page.locator("[data-subcat]");
        const n = await chips.count();
        for (let i = 1; i < n; i++) {
          // index 0 is «Все» — already audited above as the whole category
          const id = await chips.nth(i).getAttribute("data-subcat");
          const sctx: Ctx = { screen: `catalog:${cat}/${id}`, lang: L };
          await chips.nth(i).click();
          await expect(page.locator(`[data-subcat="${id}"]`), `${label(sctx)} subcat chip not selected`)
            .toHaveAttribute("aria-current", "true");
          await check(page, w, sctx);
        }
      }
    });

    test("every brand page", async ({ page }) => {
      const w = await open(page, lang.seg, "/brands/", "brands");
      await check(page, w, { screen: "brands", lang: L });

      const { brandSlugs } = await readCatalogue(page);
      expect(brandSlugs.length, "sweep: the catalogue should carry brands").toBeGreaterThan(10);
      for (const slug of brandSlugs) {
        const ctx: Ctx = { screen: `brand:${slug}`, lang: L };
        await clientNav(page, shopUrl(lang.seg, `/b/${slug}/`));
        await expectScreen(page, "catalog", ctx);
        await expect(page.locator("#catgrid .card").first(), `${label(ctx)} brand page has no products`).toBeVisible();
        await check(page, w, ctx);
      }
    });

    test("25 seeded product pages, exercised", async ({ page }) => {
      const w = await open(page, lang.seg, "/", "home");
      const { products } = await readCatalogue(page);
      const rng = makeRng(SWEEP_SEED);
      const picks = sample(rng, products, 25);

      for (const [index, p] of picks.entries()) {
        const ctx: Ctx = { screen: `product:${p.id}`, lang: L };
        await clientNav(page, shopUrl(lang.seg, `/p/${p.id}/`));
        await expectScreen(page, "product", ctx);
        await expect(page.locator(".pdp__title"), `${label(ctx)} no product title`).toBeVisible();

        // Sizes — every variant in turn; the price has to redraw for each.
        const sizes = page.locator(".sizes [data-size]");
        const nSizes = await sizes.count();
        for (let i = 0; i < nSizes; i++) {
          await sizes.nth(i).click();
          await expect(sizes.nth(i), `${label(ctx)} size ${i} did not become current`)
            .toHaveAttribute("aria-current", "true");
          await expect(page.locator("[data-price]"), `${label(ctx)} price empty at size ${i}`).not.toHaveText("");
        }

        // Gallery — every thumbnail.
        const thumbs = page.locator(".pdp__thumbs [data-gal]");
        const nThumbs = await thumbs.count();
        for (let i = 0; i < nThumbs; i++) {
          await thumbs.nth(i).click();
          await expect(thumbs.nth(i), `${label(ctx)} thumb ${i} did not become current`)
            .toHaveAttribute("aria-current", "true");
        }

        if (p.stock !== "out") {
          /* Quantity. Three up and three down on every product; the full
             hammering past both ends only on the first and last pick —
             12 extra clicks × 25 products × 3 languages is a minute of
             runtime for a property the dedicated stepper test in
             sweep-checkout.spec.ts already pins down on the cart line. */
          const plus = page.locator('.pdp__buy [data-qty="1"]');
          const minus = page.locator('.pdp__buy [data-qty="-1"]');
          const qtyNum = page.locator("[data-qtynum]");
          const hammer = index === 0 || index === picks.length - 1;
          const presses = hammer ? 12 : 3;
          for (let i = 0; i < presses; i++) await plus.click();
          await expect(qtyNum, `${label(ctx)} qty did not follow «+»`).toHaveText(hammer ? "9" : "4");
          for (let i = 0; i < presses; i++) await minus.click();
          await expect(qtyNum, `${label(ctx)} qty must clamp at 1, never 0 or below`).toHaveText("1");
        }

        // Reviews accordion.
        const rev = page.locator("details.acc", { hasText: /Отзыв|Arvustus|Review/ }).first();
        if (await rev.count()) {
          await rev.locator("summary").click();
          await expect(rev, `${label(ctx)} reviews accordion did not open`).toHaveAttribute("open", "");
        }

        // «С этим покупают» — a real section on every product page.
        const cross = page.locator("section.sec", { hasText: /С этим покупают|Sellega ostetakse|Bought together/ });
        await expect(cross.first(), `${label(ctx)} no cross-sell block`).toBeVisible();
        await expect(cross.locator(".card").first(), `${label(ctx)} cross-sell block is empty`).toBeVisible();

        await check(page, w, ctx);

        if (p.stock !== "out") {
          await page.locator(`.pdp__add[data-add="${p.id}"]`).click();
          await expect(page.getByRole("status"), `${label(ctx)} no toast after add to cart`).toBeVisible();
        }
      }

      // The badge has to agree with what went in: 25 picks, minus whatever
      // was out of stock, each added once at qty 1 — but app.js caps a single
      // line at 9, so assert the shape rather than an exact arithmetic total.
      const inStock = picks.filter((p) => p.stock !== "out").length;
      if (inStock) {
        const badge = page.locator("[data-cartbadge]");
        await expect(badge, `${label({ screen: "cart badge", lang: L })} badge missing after ${inStock} adds`)
          .toHaveText(/\d+/);
      }
    });

    test("sets, gift card, blog and every info page", async ({ page }) => {
      const w = await open(page, lang.seg, "/sets/", "bundles");
      await check(page, w, { screen: "sets", lang: L });

      const { bundles } = await readCatalogue(page);
      for (const id of bundles.slice(0, 3)) {
        const ctx: Ctx = { screen: `set:${id}`, lang: L };
        await clientNav(page, shopUrl(lang.seg, `/set/${id}/`));
        await expectScreen(page, "bundle", ctx);
        await expect(page.locator(".bitems"), `${label(ctx)} set has no component list`).toBeVisible();
        await check(page, w, ctx);
      }

      await clientNav(page, shopUrl(lang.seg, "/gift/"));
      await expectScreen(page, "gift", { screen: "gift", lang: L });
      await check(page, w, { screen: "gift", lang: L });

      await clientNav(page, shopUrl(lang.seg, "/blog/"));
      await expectScreen(page, "blog", { screen: "blog", lang: L });
      // The list is fetched after the first paint — wait for it to settle so
      // the audit sees the real screen and not "Загружаем…".
      await expect(page.locator(".bloglist, .blogcard, .empty, .muted").first()).toBeVisible();
      await check(page, w, { screen: "blog", lang: L });

      const postCtx: Ctx = { screen: `blogpost:${blogSlug}`, lang: L };
      await clientNav(page, shopUrl(lang.seg, `/blog/${blogSlug}/`));
      await expectScreen(page, "blogpost", postCtx);
      await expect(page.locator("h1"), `${label(postCtx)} post has no heading`).toBeVisible();
      await check(page, w, postCtx);

      // Every legal/info page. LEGAL is a script-level const in
      // /shop/legal.js, reachable the same way CATALOGUE is.
      const slugs = await page.evaluate(() => Object.keys(LEGAL as Record<string, unknown>));
      expect(slugs.length, "sweep: LEGAL should carry the policy pages").toBeGreaterThan(3);
      for (const slug of slugs) {
        const ctx: Ctx = { screen: `info:${slug}`, lang: L };
        await clientNav(page, shopUrl(lang.seg, `/info/${slug}/`));
        await expectScreen(page, "info", ctx);
        await expect(page.locator("h1").first(), `${label(ctx)} info page has no heading`).toBeVisible();
        await check(page, w, ctx);
      }
    });

    test("search: empty, blank, hits, misses, huge, emoji, markup, RTL", async ({ page }) => {
      const w = await open(page, lang.seg, "/search/", "search");
      await check(page, w, { screen: "search:cold", lang: L });

      const queries: Array<{ q: string; name: string }> = [
        { q: "", name: "empty" },
        { q: "   ", name: "spaces" },
        { q: "шампунь", name: "ru-hit" },
        { q: "davines", name: "brand-lowercase" },
        { q: "ZZZZ", name: "miss" },
        { q: "ш".repeat(2000), name: "2000-chars" },
        { q: "🧴💇‍♂️🔥", name: "emoji" },
        { q: "<script>alert(1)</script>", name: "markup" },
        { q: "مرحبا بالعالم שלום עולם", name: "rtl" },
      ];

      for (const { q, name } of queries) {
        const ctx: Ctx = { screen: `search:${name}`, lang: L, note: `q=${JSON.stringify(q.slice(0, 24))}` };
        await page.locator("[data-search2]").fill(q);
        await expectScreen(page, "search", ctx);
        // Whatever the query, the screen must settle into one of the three
        // legitimate states — results, the empty state, or the "popular
        // queries" prompt for a blank box.
        await expect(
          page.locator(".grid .card, .empty, .muted").first(),
          `${label(ctx)} search screen rendered nothing at all`,
        ).toBeVisible();
        await check(page, w, ctx);
      }

      // The markup query must be escaped, not executed: no injected node, and
      // the literal text on screen.
      await page.locator("[data-search2]").fill("<script>alert(1)</script>");
      const injected = await page.evaluate(() =>
        [...document.querySelectorAll("script")].filter((s) => /alert\(1\)/.test(s.textContent || "")).length,
      );
      expect(injected, `${label({ screen: "search:xss", lang: L })} the query was injected as a live <script>`).toBe(0);

      /* Reaching search from the home screen — through whichever affordance
         this viewport actually has. The header's own field is deliberately
         hidden below 768px (styles.css, "v2 mobile: give the screen back":
         it duplicated the bottom nav's Поиск tab), so on a phone the tab is
         the real path and asserting on the hidden input would be testing
         something no shopper can touch. */
      await clientNav(page, shopUrl(lang.seg, "/"));
      const viewport = page.viewportSize();
      const phone = !!viewport && viewport.width < 768;
      const ctx: Ctx = { screen: phone ? "search:from-botnav" : "search:from-header", lang: L };
      if (phone) {
        await page.locator('[data-nav="search"]').click();
        await expectScreen(page, "search", ctx);
        await page.locator("[data-search2]").fill("шампунь");
      } else {
        await page.locator("[data-search]").fill("шампунь");
      }
      await expectScreen(page, "search", ctx);
      await expect(page.locator(".grid .card").first(), `${label(ctx)} a known query found nothing`).toBeVisible();
      await check(page, w, ctx);
    });

    test("cart drawer, checkout, account and unknown URLs", async ({ page }) => {
      const { products } = await readCatalogue(page).catch(() => ({ products: [] as never[] }));
      void products;

      const w = await open(page, lang.seg, "/", "home");

      // An unknown path is not a dead end — routeFromPath() falls through to
      // the home screen (app.js), which is the app's stated contract.
      await clientNav(page, shopUrl(lang.seg, "/nope/"));
      await expectScreen(page, "home", { screen: "unknown-url", lang: L });
      await check(page, w, { screen: "unknown-url", lang: L });

      await clientNav(page, shopUrl(lang.seg, "/p/no-such-product-12345/"));
      await expectScreen(page, "home", { screen: "unknown-product", lang: L });
      await check(page, w, { screen: "unknown-product", lang: L });

      // …and neither is a cold load of one.
      await coldVisit(page, shopUrl(lang.seg, "/nope/"), "home");
      await check(page, w, { screen: "unknown-url:cold", lang: L });
      await coldVisit(page, shopUrl(lang.seg, "/p/no-such-product-12345/"), "home");
      await check(page, w, { screen: "unknown-product:cold", lang: L });

      // Empty cart drawer.
      await page.locator("[data-cart]").first().click();
      const drawer = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
      await expect(drawer, `${label({ screen: "cart:empty", lang: L })} drawer did not open`).toBeVisible();
      await check(page, w, { screen: "cart:empty", lang: L });
      await drawer.locator("[data-closecart]").first().click();
      await expect(drawer).toHaveCount(0);

      // Cart with something in it, then checkout, step by step.
      const catalogue = await readCatalogue(page);
      const rng = makeRng(SWEEP_SEED + 1);
      const buyable = catalogue.products.filter((p) => p.stock !== "out");
      const p = sample(rng, buyable, 1)[0];
      await clientNav(page, shopUrl(lang.seg, `/p/${p.id}/`));
      await expectScreen(page, "product", { screen: `product:${p.id}`, lang: L });
      await page.locator(`.pdp__add[data-add="${p.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();

      await page.locator("[data-cart]").first().click();
      await expect(drawer).toBeVisible();
      await check(page, w, { screen: "cart:full", lang: L });

      await page.locator("[data-checkout]").click();
      await expectScreen(page, "checkout", { screen: "checkout:step1", lang: L });
      await check(page, w, { screen: "checkout:step1", lang: L });

      await page.locator("[data-email]").fill("sweep@example.com");
      await page.locator('button.btn--wide[data-step="2"]').click();
      await expect(page.locator('input[data-dm="courier"]')).toBeVisible();
      await check(page, w, { screen: "checkout:step2", lang: L });

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("Sweep Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await page.locator('button.btn--wide[data-step="3"]').click();
      await expect(page.locator('input[data-paym="1"]')).toBeVisible();
      await check(page, w, { screen: "checkout:step3", lang: L });

      /* All three receipt states. `paid` and `failed` are walked for real
         through the mock bank in sweep-checkout.spec.ts; `pending` is the one
         the mock provider cannot produce (its two links are do=paid and
         do=failed — src/app/api/payments/mock/route.ts) and a real bank
         certainly can, so it is reached the way the bank would reach it: by
         landing on the receipt URL with that status. */
      for (const status of ["paid", "failed", "pending"]) {
        const ctx: Ctx = { screen: `done:${status}`, lang: L };
        await coldVisit(page, shopUrl(lang.seg, `/done/?n=R-100000&s=${status}`), "done");
        await expect(page.locator("h1"), `${label(ctx)} the receipt has no heading`).toBeVisible();
        await expect(page.locator(".done__num"), `${label(ctx)} the receipt drops the order number`)
          .toContainText("R-100000");
        await check(page, w, ctx);
      }

      // Account, signed out.
      await clientNav(page, shopUrl(lang.seg, "/account/"));
      await expectScreen(page, "account", { screen: "account:signed-out", lang: L });
      await check(page, w, { screen: "account:signed-out", lang: L });
    });
  });
}

/**
 * Cross-cutting behaviour that is about the *transition* rather than about
 * any one screen, so it is not per-language: one language proves the
 * mechanism (docs/testing.md, same reasoning as visual.spec.ts being ET-only).
 */
test.describe("sweep crawl — navigation invariants", () => {
  test("a language switch keeps the cart and stays on the same screen", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");
    const { products } = await readCatalogue(page);
    const p = products.filter((x) => x.stock !== "out")[0];

    await clientNav(page, shopUrl("", `/p/${p.id}/`));
    await expectScreen(page, "product", { screen: "lang-switch", lang: "RU" });
    await page.locator(`.pdp__add[data-add="${p.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("[data-cartbadge]")).toHaveText("1");

    await page.locator("[data-langtoggle]").click();
    await page.locator('[data-lang="ET"]').click();

    const ctx: Ctx = { screen: "lang-switch → ET", lang: "ET" };
    await expectScreen(page, "product", ctx);
    await expect(page, `${label(ctx)} the language switch left the product page`).toHaveURL(
      new RegExp(`/shop2/et/p/${p.id}/?$`),
    );
    await expect(page.locator("[data-cartbadge]"), `${label(ctx)} the cart was lost on a language switch`)
      .toHaveText("1");
    await auditScreen(page, w, ctx);
  });

  test("a reload mid-checkout keeps the cart, and Back returns to the cart's screen", async ({ page }) => {
    const w = watchPage(page);
    await coldVisit(page, shopUrl("", "/"), "home");
    const { products } = await readCatalogue(page);
    const p = products.filter((x) => x.stock !== "out")[0];

    await clientNav(page, shopUrl("", `/p/${p.id}/`));
    await page.locator(`.pdp__add[data-add="${p.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.locator("[data-cart]").first().click();
    await page.locator("[data-checkout]").click();
    await expectScreen(page, "checkout", { screen: "checkout:reload", lang: "RU" });
    await page.locator("[data-email]").fill("reload@example.com");

    await page.reload();
    const ctx: Ctx = { screen: "checkout:after-reload", lang: "RU" };
    await expectScreen(page, "checkout", ctx);
    await expect(page.locator(".cosum"), `${label(ctx)} the order summary is gone after a reload`).toBeVisible();
    await auditScreen(page, w, ctx);
    w.reset();

    // Back out of the checkout: the shopper must land back in the shop with
    // the basket intact, not on an empty screen.
    await page.goBack();
    const back: Ctx = { screen: "checkout:back", lang: "RU" };
    await expect(page.locator("[data-cartbadge]"), `${label(back)} the cart was lost going Back`).toHaveText("1");
    await auditScreen(page, w, back);
  });
});

declare const LEGAL: Record<string, unknown>;
