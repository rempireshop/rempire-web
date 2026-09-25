import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { adminSection, shopUrl } from "./fixtures";
import { openAdmin, watch } from "./sweep-helpers";

/**
 * The two things the owner asked for about pictures in an article
 * (Renat, 17.09.2026), end to end:
 *
 *   1. the cover, shown in the panel in the two frames the shop really puts
 *      it in — the list tile and the top of the article — so that «it looked
 *      one way in the editor and another in the shop» cannot happen again;
 *   2. the four sizes a picture inside the text can have, and the two steps
 *      that move it among the paragraphs.
 *
 * The third thing is not a feature but a promise: an article written before
 * any of this — a bare `<figure>`, no `data-fig` — has to render byte for
 * byte as it did. That is the last test in the file, and it is the one worth
 * keeping if the others ever go.
 *
 * Screenshots: this spec writes none unless BLOG_SHOTS names a directory.
 * With it, it drops one PNG per preset and per frame there, at whatever
 * viewport the project runs — which is how the owner was shown the result at
 * 375 px and at 1280 px without a baseline to maintain.
 */
const SHOTS = process.env.BLOG_SHOTS || "";

/* A picture this shop really serves — the suite has no bucket, so the
   «Картинка» sheet takes a URL, and an unreachable host would fail the
   console watch rather than the assertion. Square on white, which is also
   the interesting case for the cover: a 1:1 catalogue photo in a 1200×630
   frame is exactly the one that leaves white at the sides. */
const IMAGE_URL = "/shop/img/proraso-wood-spice-beard-balm-100ml-0.webp";
const COVER_URL = "/shop/img/night-rider-0.webp";

const PRESETS = ["full", "half-left", "half-right", "small"] as const;
const WORDS: Record<string, string> = {
  full: "Во всю ширину", "half-left": "Слева", "half-right": "Справа", small: "Маленькая",
};

/** Enough paragraphs for «текст рядом» to have text to run down. */
function body(fig: string | null): string {
  const p = (n: number) =>
    `<p>Абзац ${n}. Борода зимой сохнет от сухого воздуха в помещении и от ветра на улице, ` +
    "поэтому бальзам наносят на чуть влажный волос и распределяют до самых кончиков.</p>";
  const picture = fig
    ? `<figure data-fig="${fig}"><img src="${IMAGE_URL}" alt="" loading="lazy"></figure>`
    : `<figure><img src="${IMAGE_URL}" alt="" loading="lazy"></figure>`;
  return p(1) + picture + p(2) + p(3) + "<h2>Чем мыть</h2>" + p(4);
}

/**
 * Every post this file writes, so that none of them outlives the test that
 * wrote it.
 *
 * The whole suite shares one in-memory database (playwright.config.ts,
 * `workers: 1`) and the blog listing's first page holds ten articles. This
 * file publishes five per run and used to delete none, and it runs on three
 * projects — so by the second one the eleven articles it had left behind had
 * pushed all three seeded ones off page 1, and `e2e/blog.spec.ts`, which
 * opens them by slug from that listing, went red on `tablet` and nowhere
 * else. Nothing in the file itself was wrong, and nothing in blog.spec.ts
 * was either; the mess was simply not cleared up.
 *
 * CI cannot see this: its four shards each take a third of the spec files
 * into a database of their own, so the file that makes the articles and the
 * file that trips over them need not meet.
 */
const made: string[] = [];

test.afterEach(async ({ page }) => {
  while (made.length) {
    const id = made.pop() as string;
    /* Best effort: a post the test already deleted answers 404, and a
       cleanup that threw would report the wrong test as broken. */
    await page.request.delete(`/api/admin/blog/?id=${encodeURIComponent(id)}`).catch(() => undefined);
  }
});

async function makePost(page: Page, title: string, fig: string | null, cover = COVER_URL) {
  const r = await page.request.post("/api/admin/blog/", {
    data: {
      title: { RU: title, ET: "", EN: "" },
      excerpt: { RU: "Проверка картинок в статье." },
      body: { RU: body(fig) },
      coverUrl: cover,
      coverAlt: { RU: "Паста Kevin.Murphy на полке" },
    },
  });
  expect(r.status(), "the post was not created").toBe(200);
  const post = (await r.json()).post as { id: string; slug: string };
  made.push(post.id);
  return post;
}

async function publish(page: Page, id: string) {
  const r = await page.request.patch("/api/admin/blog/", { data: { id, publish: true } });
  expect(r.status(), "the post would not publish").toBe(200);
}

/**
 * One PNG, with whatever is being shown scrolled into the middle of the
 * screen and the bar's 140 ms entrance finished — a shot taken mid-animation
 * catches the bar at part opacity and reads as a transparency bug that is not
 * there, which cost an hour the first time round.
 */
async function shot(page: Page, name: string, testInfo: TestInfo, into?: string) {
  if (!SHOTS) return;
  if (into) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "center" });
    }, into);
  }
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${testInfo.project.name}.png`), fullPage: false });
}

/** «Блог» is one of the six sections that sit behind «Ещё» on a narrow
    screen — and once it has opened it is not in the bottom bar to be marked
    current, which is the one thing tab() insists on.

    Which screens are narrow is a CSS question, not a project-name one: this
    used to branch on `project.name !== "mobile"` and so sent the **tablet**
    project (iPad Mini, 768 px — the bottom bar and «Ещё» too, not the 232-px
    sidebar) down the desktop path, where `[data-admtab="blog"][aria-current]`
    never becomes visible. It passes on desktop and on mobile, which is what
    it was written against, and fails on the third Chromium project CI also
    runs (.github/workflows/ci.yml). adminSection() asks the page which
    navigation it actually drew, so there is no viewport it can be wrong on. */
async function blogTab(page: Page) {
  await adminSection(page, "blog");
  await expect(page.locator("[data-admblognew]"), "«Блог» did not open").toBeVisible();
}

/** Open a post for editing — and, on a phone, get the body onto the screen. */
async function edit(page: Page, id: string) {
  await blogTab(page);
  await page.locator(`[data-admblogedit="${id}"]`).click();
  await expect(page.locator("[data-blogbody]")).toBeVisible();
}

/* Which screens lay the halves out side by side: the one number both
   stylesheets are written against (`@media (max-width: 767px)` in
   public/shop2/styles.css for the shop and public/shop2/admin.css for the
   editor), asked of the viewport rather than of the project's name — the
   iPad Mini is 768 px, i.e. one pixel the wide side of it. */
const PHONE_MAX = 767;
function collapses(testInfo: TestInfo): boolean {
  return (testInfo.project.use.viewport?.width ?? 1280) <= PHONE_MAX;
}

/* One address per test, per project.

   Every test here signs in for itself, and POST /api/admin/login used to
   allow only five tries a minute per IP — counting the CORRECT ones. Five
   tests across the three Chromium projects is fifteen sign-ins from one
   address inside a couple of minutes, so a single `ipHeaders(174)` for the
   whole file turned the sixth of them into a 429 and the test into «the login
   card would not accept the test password» — which is what running this file
   on --project=desktop --project=mobile did.

   That limit is gone since 17.09.2026. A correct password costs nothing now,
   however often it is given: the throttle that replaced it is a delay keyed on
   the account and charged only for WRONG passwords, which these tests never
   send (src/lib/auth.ts, «failed-login backoff»). The allocation below is left
   in place — the shop's other per-IP limiters are real, and a file that gives
   every test its own address cannot be surprised by any of them — but it is no
   longer load-bearing for signing in.

   198.51.100.x (TEST-NET-2), not the 203.0.113.x the rest of the suite uses:
   that block is nearly full, and .174 in particular is already spoken for by
   e2e/admin-products.spec.ts. A documentation range nobody else in e2e/
   touches cannot collide with anything, now or later. */
const IP_BLOCK: Record<string, number> = { desktop: 10, tablet: 30, mobile: 50, "mobile-safari": 70 };
const seats = new Map<string, number>();

test.describe("blog pictures — the cover's two frames and the four presets", () => {
  test.use({
    extraHTTPHeaders: async ({}, use, testInfo) => {
      if (!seats.has(testInfo.title)) seats.set(testInfo.title, seats.size);
      const octet = (IP_BLOCK[testInfo.project.name] ?? 90) + (seats.get(testInfo.title)! % 20);
      await use({ "x-forwarded-for": `198.51.100.${octet}` });
    },
  });

  /* ---- 1. the cover, in the two frames the shop will use ----------------- */
  test("the panel shows the cover as the list and as the top of the article, through the shop's own classes", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    const post = await makePost(page, `Обложка ${Date.now().toString().slice(-6)}`, "full");

    await edit(page, post.id);
    /* 1a: the frames are in the fold under the cover tile (Dim, 18–23.09.2026:
       kept, each moved and zoomed on its own) — a toggle, opened when shut */
    const fold = page.locator('[data-admfold="blog-cover"]');
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();

    const see = page.locator(".adm-see");
    await expect(see, "the cover preview is not on the screen").toBeVisible();
    await expect(see.locator(".adm-see__one--list .adm-see__t")).toHaveText("В списке статей");
    await expect(see.locator(".adm-see__one--post .adm-see__t")).toHaveText("В начале статьи");

    /* The point of the whole thing: the frames are the SHOP's elements, drawn
       by the shop's own blogCoverFrameHTML() under the shop's own classes, so
       the rule cannot be copied wrong. If someone ever redraws this preview
       by hand, this is the assertion that says so. */
    const tile = see.locator(".blog__tileimg");
    const cover = see.locator(".blog__cover");
    await expect(tile, "the list frame is not the shop's own .blog__tileimg").toHaveCount(1);
    await expect(cover, "the article frame is not the shop's own .blog__cover").toHaveCount(1);
    for (const f of [tile, cover]) {
      await expect(f).toHaveAttribute("style", new RegExp(COVER_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    /* …and the two frames really are the two shapes: both 1200/630, which is
       what .blog__tileimg and .blog__cover say, and neither one square. */
    for (const f of [tile, cover]) {
      const box = (await f.boundingBox())!;
      expect(box.width / box.height, "a cover frame is not the shop's 1200/630").toBeCloseTo(1200 / 630, 1);
    }

    // the 16:9 crop the panel used to show instead is gone
    await expect(page.locator(".adm-cover__img"), "the old cropped thumbnail is back").toHaveCount(0);

    await shot(page, "cover-preview", testInfo, ".adm-see");
    expect(w.pageErrors, "the preview threw").toEqual([]);
  });

  /* ---- 2. the four presets, in the editor -------------------------------- */
  test("tapping a picture opens its size bar, and each preset is stored on the figure", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await openAdmin(page);
    const post = await makePost(page, `Картинки ${Date.now().toString().slice(-6)}`, "full");

    await edit(page, post.id);
    const box = page.locator("[data-blogbody]");

    // nothing on screen until a picture is tapped — the bar is not chrome
    await expect(page.locator(".adm-fig")).toHaveCount(0);

    const pic = box.locator("figure img").first();
    await pic.click();
    const bar = page.locator(".adm-fig");
    await expect(bar, "tapping the picture did not open its bar").toBeVisible();
    for (const p of PRESETS) {
      await expect(bar.locator(`[data-figset="${p}"]`)).toContainText(WORDS[p]);
    }
    // the size it already is, said out loud
    await expect(bar.locator('[data-figset="full"]')).toHaveAttribute("aria-pressed", "true");
    await shot(page, "preset-bar", testInfo, "[data-blogbody] figure");

    for (const p of PRESETS) {
      await bar.locator(`[data-figset="${p}"]`).click();
      await expect(box.locator("figure")).toHaveAttribute("data-fig", p);
      await expect(page.locator(`.adm-fig [data-figset="${p}"]`)).toHaveAttribute("aria-pressed", "true");
      await shot(page, `editor-${p}`, testInfo, "[data-blogbody] figure");
    }

    /* Half width has to be half, and the words have to be beside it — on a
       laptop. On a phone the same preset is full width instead, which is the
       whole reason these are presets and not dragged pixels. */
    await page.locator('.adm-fig [data-figset="half-left"]').click();
    const fig = box.locator("figure");
    const inner = (await box.boundingBox())!.width;
    const half = (await fig.boundingBox())!.width;
    if (collapses(testInfo)) {
      expect(half / inner, "half width did not collapse on a phone").toBeGreaterThan(0.85);
    } else {
      expect(half / inner, "half width is not about half the column").toBeLessThan(0.62);
    }
  });

  /* ---- 3. moving it among the paragraphs --------------------------------- */
  test("«Выше» and «Ниже» move the picture past the paragraphs, and stop at the ends", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    const post = await makePost(page, `Сдвиг ${Date.now().toString().slice(-6)}`, "full");
    await edit(page, post.id);
    const box = page.locator("[data-blogbody]");
    const kids = () => box.evaluate((el) => Array.from(el.children).filter((c) => !c.hasAttribute("data-figui")).map((c) => c.tagName.toLowerCase()));

    expect(await kids()).toEqual(["p", "figure", "p", "p", "h2", "p"]);
    await box.locator("figure img").first().click();
    await page.locator('[data-figmove="up"]').click();
    expect(await kids(), "«Выше» did not lift the picture over the paragraph").toEqual(["figure", "p", "p", "p", "h2", "p"]);

    // at the top there is nowhere further to go, and the button says so
    await expect(page.locator('[data-figmove="up"]')).toBeDisabled();
    await page.locator('[data-figmove="down"]').click();
    await page.locator('[data-figmove="down"]').click();
    expect(await kids()).toEqual(["p", "p", "figure", "p", "h2", "p"]);

    /* …and the move is in what gets SAVED, not only on the screen — by
       itself since 1a, a second after the last move. The bar is inside the
       box while all this happens, so this is also the check that
       blogBoxHtml() keeps it out of the body. */
    let saved = "";
    await expect.poll(async () => {
      const back = await page.request.get(`/api/admin/blog/?id=${post.id}`);
      saved = (await back.json()).post.body.RU as string;
      return saved.slice(0, saved.indexOf("<figure")).split("<p>").length - 1;
    }, { timeout: 15_000, message: "the move never saved itself" }).toBe(2);
    expect(saved, "an editor control was saved into the article").not.toContain("data-figui");
    expect(saved, "the selection ring was saved into the article").not.toContain("is-figon");
    expect(saved.indexOf("<figure"), "the picture did not keep its new place").toBeGreaterThan(saved.indexOf("</p>"));
    expect(saved.slice(0, saved.indexOf("<figure")).match(/<p>/g)!.length, "the picture is not after two paragraphs").toBe(2);
  });

  /* ---- 3b. a product card in the text has a cross (ai-blog-cards e6) ----- */
  test("tapping a product card in the text opens a bar with «Убрать карточку», and the card leaves the saved article", async ({ page }) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    const ID = "proraso-wood-spice-beard-balm-100ml";
    const cardTag = `<a data-product="${ID}" data-price="live" href="/shop2/p/${ID}/">Proraso Wood &amp; Spice — бальзам для бороды</a>`;
    const r = await page.request.post("/api/admin/blog/", {
      data: {
        title: { RU: `Карточка ${Date.now().toString().slice(-6)}`, ET: "", EN: "" },
        excerpt: { RU: "Проверка крестика на карточке." },
        body: { RU: `<p>Абзац один про бороду зимой.</p><p>${cardTag}</p><p>Абзац два про бальзам.</p>` },
      },
    });
    expect(r.status(), "the post was not created").toBe(200);
    const post = (await r.json()).post as { id: string };
    made.push(post.id);

    await edit(page, post.id);
    const box = page.locator("[data-blogbody]");
    await expect(box.locator(`a[data-product="${ID}"]`)).toHaveCount(1);
    await expect(page.locator(".adm-fig"), "a bar before anything was tapped").toHaveCount(0);

    await box.locator(`a[data-product="${ID}"]`).click();
    const x = page.locator(".adm-fig [data-cardx]");
    await expect(x, "tapping the card did not open its bar").toBeVisible();
    await expect(x).toContainText("Убрать карточку");
    await x.click();

    await expect(box.locator("a[data-product]"), "the card is still in the text").toHaveCount(0);
    await expect(page.locator(".adm-fig"), "the bar outlived the card").toHaveCount(0);
    const lines = await box.evaluate((el) => Array.from(el.children).map((c) => c.textContent || ""));
    expect(lines, "the card's empty line stayed behind").toEqual(["Абзац один про бороду зимой.", "Абзац два про бальзам."]);

    // …and it is what the article SAVES, by itself, with no editor control in it
    let saved = "";
    await expect.poll(async () => {
      const back = await page.request.get(`/api/admin/blog/?id=${post.id}`);
      saved = (await back.json()).post.body.RU as string;
      return saved.includes("data-product");
    }, { timeout: 15_000, message: "the removal never saved itself" }).toBe(false);
    expect(saved).not.toContain("data-figui");
    expect(saved).not.toContain("is-figon");
    expect(saved).toContain("Абзац два про бальзам.");
  });

  /* ---- 4. the shop renders every preset, and the bar never reaches it ---- */
  test("each preset reaches the article page, and no control of the editor's goes with it", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openAdmin(page);
    for (const p of PRESETS) {
      const post = await makePost(page, `Статья ${p} ${Date.now().toString().slice(-6)}`, p);
      await publish(page, post.id);
      await page.goto(shopUrl("", `/blog/${post.slug}/`));
      /* The page arrives prerendered and app.js then repaints it from the
         API — measuring across that swap catches a node on its way out, so
         wait for the article the SPA drew before touching anything. */
      await expect(page.locator(".blog__body:not(.blog__sk)")).toBeVisible();
      const fig = page.locator(".blog__body figure");
      await expect(fig).toHaveAttribute("data-fig", p);
      await expect(page.locator(".blog__body .adm-fig"), "an editor control reached the shop").toHaveCount(0);
      await expect(page.locator(".blog__body img.is-figon"), "the selection ring reached the shop").toHaveCount(0);
      await expect(fig).toBeVisible();
      /* The SPA repaints the article once more when the API answers, so a
         handle taken before that is stale by the time it is scrolled. Waiting
         for the network to go quiet and then reaching for the element inside
         the page takes it fresh, whichever repaint it belongs to. */
      await page.waitForLoadState("networkidle");
      await shot(page, `shop-${p}`, testInfo, ".blog__body figure");

      const col = (await page.locator(".blog__body").boundingBox())!.width;
      const pic = (await fig.boundingBox())!.width;
      if (p === "small") expect(pic, "«маленькая» is not small").toBeLessThan(col * 0.7);
      else if (p === "full") expect(pic / col, "«во всю ширину» is not full width").toBeGreaterThan(0.9);
      else if (collapses(testInfo)) {
        expect(pic / col, "half width did not collapse on a phone").toBeGreaterThan(0.9);
      } else {
        expect(pic / col, "half width is not about half the column").toBeLessThan(0.62);
      }
    }
  });

  /* ---- 5. the promise: an older article is untouched --------------------- */
  test("an article written before the presets renders exactly as it did — a bare figure stays bare", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    const post = await makePost(page, `Старая ${Date.now().toString().slice(-6)}`, null);
    await publish(page, post.id);

    await page.goto(shopUrl("", `/blog/${post.slug}/`));
    await expect(page.locator(".blog__body:not(.blog__sk)")).toBeVisible();
    const fig = page.locator(".blog__body figure");
    await expect(fig).toHaveCount(1);
    expect(await fig.evaluate((el) => el.hasAttribute("data-fig")), "a preset was invented for an old article").toBe(false);
    /* …and none of the preset rules can reach it. Polled, not read once: the
       SPA repaints the article when the API answers, and a computed style
       taken across that repaint comes back empty rather than wrong. */
    await expect
      .poll(async () => fig.evaluate((el) => getComputedStyle(el).cssFloat), { message: "an old article's picture started floating" })
      .toBe("none");
    // it still stands on its own line, with the words below it and not beside
    const gap = await fig.evaluate((el) => {
      const next = el.nextElementSibling as HTMLElement | null;
      return next ? next.getBoundingClientRect().top - el.getBoundingClientRect().bottom : 0;
    });
    expect(gap, "the words moved up beside an old article's picture").toBeGreaterThanOrEqual(0);

    /* Opening it in the editor and leaving without touching a picture must
       not write a preset either — the draft is what «Сохранить» sends. The
       session from the top of the test is still good, so this walks back into
       the panel rather than signing in again. */
    await page.goto(shopUrl("", "/admin/"));
    await edit(page, post.id);
    const box = page.locator("[data-blogbody]");
    await expect(box.locator("figure")).toHaveCount(1);
    expect(await box.locator("figure").evaluate((el) => el.hasAttribute("data-fig"))).toBe(false);
  });
});
