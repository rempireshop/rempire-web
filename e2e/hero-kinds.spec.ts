import { expect, test, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { adminSection, ipHeaders, loginAsAdmin, shopUrl, waitForScreen } from "./fixtures";

/**
 * The home banner's three kinds (Dim, 02.11.2026 — the design in
 * Rempire/canvas-banner): «Фото на всю ширину» (wide), «Фото на половину»
 * (half) and «Товар» (product), each on a phone and on a computer.
 *
 * Nothing is written to the database: the banner arrives through the public
 * feed the storefront reads (/api/overrides/), which this spec answers with
 * its own `settings.hero`, and the photographs are drawn here with sharp and
 * served from an address of this spec's own. What is checked is what the
 * shopper meets — the words and the button inside the band, the photo where
 * the kind puts it, the carousel's controls as real 44-pixel buttons — and
 * that every kind fills the SAME band, which is what keeps the page under it
 * from moving when a slide of one kind follows another.
 *
 * And the measures Dim asked for on 02.11.2026, after he had measured the
 * live band at 594 px on a 1440 screen and seen Renat's 1024-px photos blown
 * up on his own 2000-px one: the band is ~440 px on a computer, a «half»
 * photo stays inside the shop's column, a cut-out is never drawn larger than
 * its file, the phone's band is a 4:3 photo and its words (~480 px), and
 * there are no dots under it on any screen.
 *
 * It sets its own viewports, so it runs on the desktop project only.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own phone and computer viewports — desktop project only");
});
test.use({ extraHTTPHeaders: ipHeaders(61) });

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 2000, height: 1100 },
] as const;
/** styles.css --maxw: the shop's column, the box the banner's words stand in. */
const MAXW = 1240;

type Kind = "wide" | "half" | "product";

const slide = (kind: Kind, extra: Record<string, unknown> = {}) => ({
  id: `e2e-${kind}`,
  eyebrow: { RU: "Таллинн · Mardi 1" },
  title: { RU: kind === "wide" ? "Борода в форме" : kind === "half" ? "Профессиональный уход" : "Мыло ручной работы" },
  sub: { RU: "Масла, бальзамы и воски — то, чем работают барберы." },
  cta: { RU: "Смотреть" },
  go: "cat:beard",
  on: true,
  ...(kind === "wide"
    ? { image: "/e2e-hero/hero/wide.webp", kind, side: "left", focus: { x: 0.5, y: 0.4 }, w: 1600, h: 900 }
    : kind === "half"
      ? { image: "/e2e-hero/hero/square.webp", kind, focus: { x: 0.5, y: 0.45 }, w: 1000, h: 1000 }
      // no kind at all — a catalogue product is read as «Товар», as every old banner is
      : { image: "handmade-soap-666" }),
  ...extra,
});

/** A photograph to stand in for Renat's: a gradient with a light patch, so a crop is visible on a screenshot. */
async function photo(w: number, h: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b5440"/><stop offset="1" stop-color="#c9b79c"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.6}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.2}" fill="#efe6d6"/></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
}

/** A small cut-out: a bottle on nothing, 200 × 300 — smaller than the band's frame for it. */
async function cutout(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect x="60" y="20" width="80" height="270" rx="30" fill="#3d3a2a"/></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

async function serveBanner(page: Page, slides: unknown[]): Promise<void> {
  // the tower drawing that opens a first visit (intro() in app.js) would cover the band on every screenshot
  await page.addInitScript(() => { try { sessionStorage.setItem("rempire-intro", "1"); } catch { /* private mode */ } });
  const wide = await photo(1600, 900);
  const square = await photo(1000, 1000);
  const bottle = await cutout();
  await page.route(/\/e2e-hero\/hero\/(wide|square|bottle-cutout)(-thumb)?\.webp$/, (route: Route) => {
    const url = route.request().url();
    return route.fulfill({ status: 200, contentType: "image/webp", body: /wide/.test(url) ? wide : /bottle/.test(url) ? bottle : square });
  });
  await page.route(/\/api\/overrides\/?(\?.*)?$/, async (route: Route) => {
    const res = await route.fetch();
    const json = await res.json().catch(() => ({ ok: true, overrides: {}, settings: {} }));
    json.ok = true;
    json.settings = { ...(json.settings || {}), hero: { slides, interval: 30000 } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });
}

async function openHome(page: Page, kind: Kind): Promise<void> {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await expect(page.locator(`.hero__slide--${kind}[data-on="1"]`)).toBeVisible();
}

/** The box of `sel` inside the slide on screen, and the band's. */
async function inside(page: Page, sel: string): Promise<void> {
  const band = await page.locator(".hero").boundingBox();
  const el = page.locator(`.hero__slide[data-on="1"] ${sel}`);
  await expect(el, `${sel} is not visible`).toBeVisible();
  const box = await el.boundingBox();
  expect(band && box, `${sel} has no box`).toBeTruthy();
  expect(box!.y, `${sel} starts above the banner`).toBeGreaterThanOrEqual(band!.y - 1);
  expect(box!.y + box!.height, `${sel} runs below the banner`).toBeLessThanOrEqual(band!.y + band!.height + 1);
  expect(box!.x, `${sel} starts left of the banner`).toBeGreaterThanOrEqual(band!.x - 1);
  expect(box!.x + box!.width, `${sel} runs past the banner's right edge`).toBeLessThanOrEqual(band!.x + band!.width + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(`home banner kinds — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    const heights: Partial<Record<Kind, number>> = {};

    for (const kind of ["wide", "half", "product"] as const) {
      test(`${kind}: the words and the button are inside the banner`, async ({ page }, testInfo) => {
        await serveBanner(page, [slide(kind)]);
        await openHome(page, kind);
        await inside(page, ".hero__title");
        await inside(page, ".hero__eyebrow");
        await inside(page, ".btn");
        // the phone's «half» drops the subtitle, as the design does (Kind2Phone)
        if (!(kind === "half" && vp.name === "phone")) await inside(page, ".hero__sub");
        else await expect(page.locator('.hero__slide[data-on="1"] .hero__sub')).toBeHidden();

        const on = page.locator('.hero__slide[data-on="1"]');
        const band = (await page.locator(".hero").boundingBox())!;
        if (kind === "product") {
          const img = on.locator(".hero__art img");
          await expect(img).toBeVisible();
          await expect(on.locator(".hero__photo")).toHaveCount(0);
          // a catalogue cut-out (900 × 689) is never drawn larger than its file
          await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
          const fit = await img.evaluate((el: HTMLImageElement) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, nw: el.naturalWidth, nh: el.naturalHeight }));
          expect(fit.w, JSON.stringify(fit)).toBeLessThanOrEqual(fit.nw + 1);
          expect(fit.h, JSON.stringify(fit)).toBeLessThanOrEqual(fit.nh + 1);
          // …and it stands in the middle of the band's height (its frame is centred, the picture in it)
          const ib = (await img.boundingBox())!;
          if (vp.name !== "phone") expect(Math.abs(ib.y + ib.height / 2 - (band.y + band.height / 2)), JSON.stringify({ ib, band })).toBeLessThan(3);
        } else {
          const img = on.locator(".hero__photo img");
          await expect(img).toBeVisible();
          await expect(img).toHaveAttribute("fetchpriority", "high");
          expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
          // the upload's small copy is offered beside the photo (srcset)
          await expect(img).toHaveAttribute("srcset", /-thumb\.webp \d+w, .+ \d+w/);
        }
        // white words on a full-width photo, ink on the beige otherwise
        const color = await on.locator(".hero__title").evaluate((el) => getComputedStyle(el).color);
        expect(color).toBe(kind === "wide" ? "rgb(255, 255, 255)" : "rgb(28, 26, 0)");
        if (kind === "half") {
          const ph = (await on.locator(".hero__photo").boundingBox())!;
          const box = (await on.locator(".hero__box").boundingBox())!;
          if (vp.name === "phone") {
            // a full-width 4:3 photo on top (of the window's width: a desktop browser's scrollbar takes 15 px of the band)
            expect(Math.abs(ph.width - band.width)).toBeLessThan(2);
            const vw = await page.evaluate(() => window.innerWidth);
            expect(Math.abs(ph.height - Math.min(vw, 480) * 0.75), JSON.stringify({ ph, vw })).toBeLessThan(2);
          } else {
            // the right 62 % of the shop's column, at the band's full height — never wider than the column
            const col = Math.min(band.width, MAXW);
            expect(ph.width, JSON.stringify({ ph, box })).toBeLessThanOrEqual(col * 0.62 + 1);
            expect(ph.width).toBeLessThanOrEqual(box.width + 1);
            expect(ph.x + ph.width, "the photo runs past the shop's column").toBeLessThanOrEqual(box.x + box.width + 1);
            expect(Math.abs(ph.x + ph.width - (box.x + box.width))).toBeLessThan(2);
            expect(Math.abs(ph.height - band.height)).toBeLessThan(2);
            // a 1000-px photo is only ever drawn smaller than its file, never blown up
            expect(Math.max(ph.width, ph.height) / 1000).toBeLessThanOrEqual(1);
            if (band.width > MAXW) {
              // the photo ends before the window does: its right edge fades into the beige too
              const fades = await on.locator(".hero__photo").evaluate((el) => getComputedStyle(el, "::after").backgroundImage);
              expect(fades.match(/linear-gradient/g), fades).toHaveLength(2);
            }
          }
        }
        if (kind === "wide") {
          const ph = (await on.locator(".hero__photo").boundingBox())!;
          expect(Math.abs(ph.width - band.width)).toBeLessThan(2);
          expect(Math.abs(ph.height - band.height)).toBeLessThan(2);
        }
        // the band's height (Dim, 02.11.2026): ~440 on a computer, a 4:3 photo and the words (~480) on a phone
        if (vp.name === "phone") {
          expect(band.height, `phone band ${band.height}`).toBeGreaterThanOrEqual(465);
          expect(band.height, `phone band ${band.height}`).toBeLessThanOrEqual(495);
        } else {
          expect(band.height, `band ${band.height} at ${vp.width}`).toBeLessThanOrEqual(450);
          expect(band.height).toBeGreaterThanOrEqual(360);
        }
        await expect(page.locator(".hero__dot, .hero__dots")).toHaveCount(0);
        heights[kind] = band.height;
        // for a human to look at: the band, and the page around it
        await page.locator(".hero").screenshot({ path: testInfo.outputPath(`${vp.name}-${kind}.png`) });
        await page.screenshot({ path: testInfo.outputPath(`${vp.name}-${kind}-page.png`) });
      });
    }

    test("a cut-out smaller than its frame stands at its own size, never blown up", async ({ page }) => {
      await serveBanner(page, [slide("product", { image: "/e2e-hero/hero/bottle-cutout.webp", kind: "product", w: 200, h: 300 })]);
      await openHome(page, "product");
      const img = page.locator('.hero__slide[data-on="1"] .hero__art img');
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(200);
      const b = (await img.boundingBox())!;
      expect(Math.round(b.width), JSON.stringify(b)).toBeLessThanOrEqual(200);
      expect(Math.round(b.height), JSON.stringify(b)).toBeLessThanOrEqual(300);
      // its frame is larger than the file, so it is the file's own size, in the frame's middle
      const art = (await page.locator('.hero__slide[data-on="1"] .hero__art').boundingBox())!;
      if (art.height > 300) expect(Math.round(b.height)).toBe(300);
      expect(Math.abs(b.x + b.width / 2 - (art.x + art.width / 2))).toBeLessThan(2);
      expect(Math.abs(b.y + b.height / 2 - (art.y + art.height / 2))).toBeLessThan(2);
    });

    test("every kind fills the same band — a slide of another kind moves nothing under it", async () => {
      const got = Object.values(heights);
      test.skip(got.length < 3, "needs the three runs above");
      for (const h of got) expect(Math.abs(h - got[0]), JSON.stringify(heights)).toBeLessThanOrEqual(1);
    });

    test("the carousel is two arrows, 44 px to hit, that say where they go and follow the slide's kind — no dots", async ({ page }, testInfo) => {
      await serveBanner(page, [slide("wide"), slide("half"), slide("product")]);
      await openHome(page, "wide");
      await page.locator(".hero").screenshot({ path: testInfo.outputPath(`${vp.name}-carousel.png`) });
      const band = page.locator(".hero");
      await expect(band).toHaveAttribute("data-kind", "wide");
      for (const sel of [".hero__arrow--prev", ".hero__arrow--next"]) {
        const b = page.locator(sel);
        await expect(b).toBeVisible();
        expect(await b.evaluate((el) => el.tagName)).toBe("BUTTON");
        const box = (await b.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        // white over the photograph
        expect(await b.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
      }
      // Dim, 02.11.2026: the dots had come back by mistake — none, on any screen
      await expect(page.locator(".hero__dot, .hero__dots, [data-slideto]")).toHaveCount(0);
      // the count lives in the arrows' names
      await expect(page.locator(".hero__arrow--prev")).toHaveAttribute("aria-label", "Предыдущий баннер — 3 из 3");
      await expect(page.locator(".hero__arrow--next")).toHaveAttribute("aria-label", "Следующий баннер — 2 из 3");

      await page.locator(".hero__arrow--next").click();
      await expect(page.locator('.hero__slide--half[data-on="1"]')).toBeVisible();
      await expect(band).toHaveAttribute("data-kind", "half");
      await expect(page.locator(".hero__arrow--next")).toHaveAttribute("aria-label", "Следующий баннер — 3 из 3");
      await page.locator(".hero__arrow--next").click();
      await expect(page.locator('.hero__slide--product[data-on="1"]')).toBeVisible();
      await expect(band).toHaveAttribute("data-kind", "product");
      await expect(page.locator(".hero__arrow--prev")).toHaveAttribute("aria-label", "Предыдущий баннер — 2 из 3");
      // on the beige the arrows are ink again
      expect(await page.locator(".hero__arrow--prev").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(28, 26, 0)");
      // …and round again to the first
      await page.locator(".hero__arrow--next").click();
      await expect(page.locator('.hero__slide--wide[data-on="1"]')).toBeVisible();
      // the first slide only is fetched first
      await expect(page.locator(".hero__slide").nth(1).locator("img")).toHaveAttribute("loading", "lazy");
    });

    test("a full-width photo puts its words on the side it is given", async ({ page }) => {
      test.skip(vp.name === "phone", "on a phone the words of every full-width slide sit at its foot");
      for (const side of ["left", "center", "right"] as const) {
        await serveBanner(page, [slide("wide", { side })]);
        await openHome(page, "wide");
        const band = (await page.locator(".hero").boundingBox())!;
        const t = (await page.locator('.hero__slide[data-on="1"] .hero__inner').boundingBox())!;
        const mid = t.x + t.width / 2 - band.x;
        if (side === "left") expect(mid).toBeLessThan(band.width * 0.4);
        if (side === "center") expect(Math.abs(mid - band.width / 2)).toBeLessThan(4);
        if (side === "right") expect(mid).toBeGreaterThan(band.width * 0.6);
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
    });
  });
}

/* The panel's «Вид баннера» (Panel.dc.html), on a phone as Renat uses it.
   This one does write — to the suite's own in-memory database, and the
   banner that was there is put back in `finally`, as every banner spec does.
   The upload itself is answered here (no bucket in this suite): what is
   checked is what the panel does with the answer. */
test.describe("panel — «Вид баннера»", () => {
  test.use({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: ipHeaders(62) });

  test("an upload picks the kind by itself; kind, side and focus point save at once", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const wide = await photo(1600, 900);
    await page.route(/\/e2e-hero\/hero\/(wide|square)(-thumb)?\.webp$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: wide }));
    await page.route(/\/api\/admin\/upload\/?(\?.*)?$/, (route: Route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, cutout: false, maxBytes: 12582912 }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          ok: true, key: "hero/1-wide.webp", url: "/e2e-hero/hero/wide.webp", thumbUrl: "/e2e-hero/hero/wide-thumb.webp", width: 1600, height: 900,
        }) }));
    await loginAsAdmin(page);
    const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings;
    const before = await stored();
    const first = async () => ((await stored()).hero?.slides?.[0] ?? {}) as Record<string, unknown>;
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="home"]').click();
      await page.locator('[data-heroedit="0"]').click();
      const look = page.locator("[data-herolook]");
      await expect(look.getByRole("radiogroup", { name: "Вид баннера" })).toBeVisible();
      // the shop's own first slide is a catalogue product: «Товар», nothing to crop
      await expect(look.locator('[data-herokind="product"]')).toHaveAttribute("aria-checked", "true");
      await expect(look.locator("[data-herofocusbox]")).toBeHidden();

      // a landscape photo: «Фото на всю ширину», chosen by itself, and said so
      await page.locator('[data-galfile="hero"]').setInputFiles({ name: "beard.webp", mimeType: "image/webp", buffer: wide });
      await expect(look.locator('[data-herokind="wide"]')).toHaveAttribute("aria-checked", "true");
      await expect(look.locator("[data-herokindhint]")).toHaveText("Загрузили горизонтальное фото — вид выбран сам. Можно поменять.");
      await expect.poll(async () => (await first()).kind, { timeout: 20_000 }).toBe("wide");
      expect(await first()).toMatchObject({ image: "/e2e-hero/hero/wide.webp", w: 1600, h: 900 });
      await expect(look.locator("[data-herosidebox]")).toBeVisible();
      await expect(look.locator("[data-heromini] .adm-heromini__f--wide")).toHaveCount(2);

      // «Справа»
      await look.locator('[data-heroside="right"]').click();
      await expect(look.locator('[data-heroside="right"]')).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await first()).side, { timeout: 20_000 }).toBe("right");

      // a tap on the photo is the point that stays in the frame
      const img = look.locator("[data-herofocus] img");
      await expect(img).toBeVisible();
      const box = (await img.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
      await expect.poll(async () => (await first()).focus as { x: number; y: number } | undefined, { timeout: 20_000 })
        .toMatchObject({ x: expect.closeTo(0.25, 1), y: expect.closeTo(0.75, 1) });
      const dot = await look.locator(".adm-herofocus__dot").getAttribute("style");
      expect(dot).toMatch(/left:2\d(\.\d)?%;top:7\d(\.\d)?%/);
      await look.screenshot({ path: testInfo.outputPath("panel-look-wide.png") });
      await page.locator("#heroprev").screenshot({ path: testInfo.outputPath("panel-preview-wide.png") });

      // «Фото на половину»: the side is a full-width photo's only
      await look.locator('[data-herokind="half"]').click();
      await expect.poll(async () => (await first()).kind, { timeout: 20_000 }).toBe("half");
      await expect(look.locator("[data-herosidebox]")).toBeHidden();
      await expect(look.locator("[data-herofocusbox]")).toBeVisible();

      // «Товар» on a shop with no ✂: the line says why the background stays
      await look.locator('[data-herokind="product"]').click();
      await expect.poll(async () => (await first()).kind, { timeout: 20_000 }).toBe("product");
      await expect(look.locator("[data-herokindhint]")).toContainText("Фон здесь убрать не получится");
      await look.screenshot({ path: testInfo.outputPath("panel-look-product.png") });
    } finally {
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }
  });
});
