import { expect, test } from "@playwright/test";
import { CATEGORY, eur, functionalProject, ipHeaders, LANGS, PRODUCT, searchFor, shopUrl, tr, waitForScreen } from "./fixtures";
import variants from "../src/data/catalogue.variants.json";

/** Category nav, brand page, search, infinite scroll, and the product card
 *  itself — its one price, its «В корзину» and its geometry.
 *
 *  The desktop-only guard used to be one file-level `beforeEach`. It is a
 *  per-describe call now because one block in this file — "product card —
 *  layout" — is the exception the rule allows for: what it asserts is
 *  geometry, and a card is a 150px grid track on a phone against a 200px one
 *  on a laptop, so the two-line name clamp and the two-row foot have to be
 *  measured at 375px as well (docs/testing.md "Why most specs run on desktop
 *  only"). Everything else here is business logic or text that does not
 *  change with viewport width and still opts in to desktop only. */
function desktopOnly(): void {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
  });
}
test.use({ extraHTTPHeaders: ipHeaders(20) });

/** A single-size, in-stock product sitting in the same /c/hair/ listing as
 *  PRODUCT — the control case for "one volume or several, the card is the
 *  same shape". Its price is deliberately not asserted anywhere: the admin
 *  sweeps may edit a randomly sampled product's price, and this test only
 *  cares about the card's structure. */
const SINGLE_SIZE_PRODUCT = "touchable";

/** src/data/catalogue.variants.json — the volumes and their prices the shop
 *  is built from. Read from the file rather than copied into a constant here
 *  so that a price Renat edits in «Товары → Размеры и цены», and then
 *  regenerates the file from, moves the expectation with it instead of
 *  turning these tests red for something that is not a bug. */
const VARIANTS: Record<string, { sizes: string[]; prices: number[] }> = variants;

/** A multi-volume product reachable in one listing — the search screen
 *  renders every hit at once, so no paging is needed to find it.
 *
 *  It used to be here for a sharper reason: RE.STORE read 36 € for 40 мл and
 *  7 € for 200 мл, which made it the one product where "cheapest" and "first
 *  in the list" disagreed. That turned out to be a fault in the data rather
 *  than a fact about the shop — tools/build-catalogue-full.mjs sorted the
 *  volumes before it had built the price list, so 34 products ended up with
 *  ascending volumes against the store's unsorted prices. With that repaired
 *  every product is cheapest-first, and the rule is pinned instead by the
 *  sweep below, which checks every multi-volume card in two listings. */
const MULTI = "kevin-murphy-re-store";

/** The volume a card must speak for — the cheapest, by price and not by
 *  position (cardSizeIdx in app.js). */
function cheapest(id: string): { index: number; size: string; price: number } {
  const v = VARIANTS[id];
  if (!v) throw new Error(`e2e/catalogue.spec.ts: "${id}" has no entry in src/data/catalogue.variants.json`);
  let index = 0;
  for (let i = 1; i < v.prices.length; i++) if (v.prices[i] < v.prices[index]) index = i;
  return { index, size: v.sizes[index], price: v.prices[index] };
}

/** The card's add-to-cart toast opens with this. It comes from a UI_RX
 *  *pattern* in app.js (`/^Добавлено: (.+)$/` → «Lisatud: $1» / «Added: $1»),
 *  not from the flat `UI` table fixtures.ts's DICT is copied out of, which is
 *  why it is spelled out here instead of going through tr(). */
const ADDED = { RU: "Добавлено:", ET: "Lisatud:", EN: "Added:" } as const;
/** «75 мл» has to reach an Estonian shopper as «75 ml». It did not until
 *  09.09.2026: the cart line put the product name and the volume in one text
 *  node, and translateTree() works a text node at a time, so neither the
 *  Russian type-tail nor the unit matched anything. */
const UNIT = { RU: "мл", ET: "ml", EN: "ml" } as const;

/** A card by the product it is for. Re-queried rather than held in a
 *  variable: patchCatalog() and render() both replace the element. */
const cardFor = (page: import("@playwright/test").Page, id: string) =>
  page.locator(".card", { has: page.locator(`[data-go-product="${id}"]`) }).first();

for (const lang of LANGS) {
  test.describe(`catalogue — ${lang.code}`, () => {
    desktopOnly();

    test("category navigation lists products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`[data-go-cat="${CATEGORY.id}"]`).first().click();
      await waitForScreen(page, "catalog");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/c/${CATEGORY.id}/?$`));

      await expect(page.locator("#catgrid .card").first()).toBeVisible();
      // "N товаров" / "N toodet" / "N products" — assert the number only,
      // the surrounding word is a UI_RX-templated string (app.js), not a
      // fixed dictionary key, so a regex on the digits is the robust check.
      await expect(page.locator("[data-count]")).toHaveText(/\d+/);
    });

    test("brand page shows only that brand's products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`.brandstrip__it[data-go-brand="${PRODUCT.brand}"]`).click();
      await waitForScreen(page, "catalog");
      // A brand with a logo (BRAND_LOGOS, brandMark() in app.js) renders
      // `<span role="img" aria-label="…">` — a CSS background-image, not a
      // real <img>/alt — instead of plain text; System 4 is one of those.
      // getByRole('img', {name}) reads the computed accessible name (works
      // for both that case and the plain-text one other brands use), where
      // .textContent() would see an empty string and getByAltText() would
      // never match at all (there is no `alt` attribute here to read).
      await expect(page.getByText(PRODUCT.brand).or(page.getByRole("img", { name: PRODUCT.brand })).first()).toBeVisible();
      await expect(page.locator("#catgrid .card").first()).toBeVisible();
    });

    test("search finds results and shows an empty state for gibberish", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Brand names are not translated (Latin, no Cyrillic — translateTree()
      // skips them), so one query string works in all three languages.
      // searchFor() goes through the header field on a laptop and the
      // bottom nav's «Поиск» tab on a phone — see fixtures.ts.
      await searchFor(page, "System");
      await expect(page).toHaveURL(/\/search\/\?q=System/);
      await expect(page.locator(".grid .card").first()).toBeVisible();

      await page.locator("[data-search2]").fill("zzzznonexistentquery12345");
      await expect(page.locator(".empty, .muted", { hasText: "zzzznonexistentquery12345" })).toBeVisible();
    });

    test("infinite scroll appends more products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/")); // hair has the most SKUs — guarantees >12
      await waitForScreen(page, "catalog");

      const cards = page.locator("#catgrid .card");
      const before = await cards.count();
      expect(before).toBeGreaterThan(0);

      const sentinel = page.locator("#sentinel");
      if ((await sentinel.count()) === 0) {
        test.skip(true, "fewer than 12 products in this category — nothing to page in");
      }
      await sentinel.scrollIntoViewIfNeeded();
      // The observer debounces on a 320ms timer (app.js) before appending.
      await expect(async () => {
        expect(await cards.count()).toBeGreaterThan(before);
      }).toPass({ timeout: 5_000 });
    });
  });

  /* The product card as the owner asked for it on 09.09.2026 («размеры и мл
   * не нужны»): no picker, one price, «В корзину» under it. The card used to
   * carry a native <select>; the shopper now gets the cheapest volume without
   * choosing, and both the price on the card and the line in the cart have to
   * say so. Trilingual because the price format, the button's label and the
   * toast all go through the dictionary. */
  test.describe(`product card — ${lang.code}`, () => {
    desktopOnly();

    test("a multi-volume card shows the cheapest volume's price", async ({ page }) => {
      const cheap = cheapest(MULTI);
      // The catalogue is cheapest-first everywhere since the pairing was
      // repaired, so this product no longer distinguishes "cheapest" from
      // "first" on its own. The sweep further down is what pins that; here
      // the point is that a multi-volume card prints ONE exact price.

      // The search screen renders every hit in one grid (no paging), so this
      // product is reachable there; it is past the first twelve of /c/hair/.
      // Straight to the URL rather than through searchFor(): the search box
      // has its own test above and is not what this one is about.
      await page.goto(shopUrl(lang.seg, "/search/?q=RE.STORE"));
      await waitForScreen(page, "search");

      const price = cardFor(page, MULTI).locator(".card__price");
      await expect(price).toHaveText(eur(cheap.price, lang.code));
      const dearest = Math.max(...VARIANTS[MULTI].prices);
      await expect(price).not.toHaveText(eur(dearest, lang.code));

      // …and again in an ordinary listing: the card must print an exact
      // price, never the old «от 9 €», which is a range and not something you
      // can put a single «В корзину» under.
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");
      await expect(cardFor(page, PRODUCT.id).locator(".card__price"))
        .toHaveText(eur(cheapest(PRODUCT.id).price, lang.code));
    });

    test("«В корзину» on a multi-volume card puts that volume in the cart", async ({ page }) => {
      const cheap = cheapest(MULTI);
      await page.goto(shopUrl(lang.seg, "/search/?q=RE.STORE"));
      await waitForScreen(page, "search");

      await cardFor(page, MULTI).locator(`[data-add="${MULTI}"]`).click();

      // The toast names the volume — «Добавлено: RE.STORE · 200 мл». Without
      // it the card would be silently adding a 200 мл bottle to a basket the
      // shopper never picked a size for. The number is the same in all three
      // languages, the unit is not, so assert the digits.
      const toast = page.getByRole("status");
      await expect(toast).toContainText(ADDED[lang.code]);
      await expect(toast).toContainText(cheap.size.replace(/\D+/g, ""));
      await expect(page.locator("[data-cartbadge]")).toHaveText("1");

      // The real point: the cart, not just the toast. This is the whole
      // regression — «В корзину» must put the 7 € / 200 мл bottle in, not the
      // 36 € / 40 мл one that heads the variant list.
      await page.locator("[data-cart]").first().click();
      const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
      await expect(dialog).toBeVisible();
      const line = dialog.locator(".cline").first();
      await expect(line.locator(".cline__nm")).toContainText(cheap.size.replace(/\D+/g, ""));
      // …and the unit beside that number in the shopper's own language, not
      // the Cyrillic «мл» an English basket used to show.
      await expect(line.locator(".lsz")).toHaveText(`${cheap.size.replace(/\D+/g, "")} ${UNIT[lang.code]}`);
      if (lang.code !== "RU") await expect(line.locator(".cline__nm")).not.toContainText("мл");
      await expect(line.locator("[data-linepr]")).toHaveText(eur(cheap.price, lang.code));
      await expect(line.locator("[data-qtyval]")).toHaveText("1");
    });

    test("no card carries a size control, and every language says the whole «В корзину»", async ({ page }) => {
      /* cardHTML() is shared, so whatever is wrong with a card is wrong on
         every list built from it — the home rails and the search results,
         not only the catalogue grid. */
      for (const [where, url, screen] of [
        ["catalogue", shopUrl(lang.seg, "/c/hair/"), "catalog"],
        ["home rails", shopUrl(lang.seg, "/"), "home"],
        ["search", shopUrl(lang.seg, "/search/?q=System"), "search"],
      ] as const) {
        await page.goto(url);
        await waitForScreen(page, screen);
        await expect(page.locator(".card").first()).toBeVisible();

        const report = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
          return {
            cards: cards.length,
            /* Every trace the picker left behind. A half-removal — the markup
               gone but a stray <select> still emitted by one code path, or the
               `.card__sp` price/size row surviving in the stylesheet — is
               exactly what would slip through a test that only looked at the
               one product it had in mind. */
            leftovers: [
              "[data-cardsizeopen]", "[data-cardsizepick]", "[data-cardpop]", "[data-cardpr]",
              ".card__sizebtn", ".card__pop", ".card__opt", ".card__sizelbl", ".card__sp",
              ".card__addtxt", ".card__bag", ".card select", ".card [role='listbox']",
            ].filter((sel) => document.querySelectorAll(sel).length),
            // the foot is two rows and nothing else: the price, then the link
            feet: cards.map((c) => Array.from(c.querySelector(".card__foot")?.children ?? [])
              .map((el) => el.className.split(" ")[0]).join("+")),
          };
        });

        expect(report.cards, `${where}: no cards rendered — the check would be vacuous`).toBeGreaterThan(0);
        expect(report.leftovers, `${where}: the card size picker left something behind`).toEqual([]);
        expect([...new Set(report.feet)], `${where}: a card foot is not «price, then add»`).toEqual(["card__price+card__add"]);

        /* «Lisa korvi» was Estonian's shortened label, needed while the price,
           the volume and the link shared one 155px row. The link owns a row of
           its own now, so all three languages say the whole thing — and this
           runs on the phone project too (mobile-safari), which is where the
           short form used to appear. */
        const adds = page.locator(".card__add:not(.card__add--notify)");
        expect(await adds.count(), `${where}: no in-stock card to read a label off`).toBeGreaterThan(0);
        /* textContent, not innerText: styles.css gives every card
           `content-visibility: auto`, and innerText is a *rendered* text
           reading — it answers "" for a card that has never been near the
           viewport, so half this grid would silently compare against an
           empty string instead of its label. */
        for (const text of await adds.allTextContents()) expect(text.trim()).toBe(tr("В корзину", lang.code));
      }
    });

    test("a single-volume product's card is the same shape as a multi-volume one", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");

      // Both are just «price / В корзину» now. The interesting half is the
      // single-size one: cardPriceText() still has a «от …» branch for a
      // product with priceFrom, and «от 9 €» over a button that adds one
      // definite thing is the same wrong sentence the picker was removed for.
      for (const id of [SINGLE_SIZE_PRODUCT, PRODUCT.id]) {
        const card = cardFor(page, id);
        await expect(card).toBeVisible();
        await expect(card.locator(".card__price")).toHaveText(/^[^…]*\d/);
        await expect(card.locator(".card__price")).not.toContainText(/^от |^alates |^from /i);
        await expect(card.locator(`.card__add[data-add="${id}"]`)).toBeVisible();
      }
    });
  });
}

/* The cheapest-volume rule over the whole catalogue rather than the one
 * product that motivated it. Prices and euro formatting, no dictionary — one
 * language is enough (docs/testing.md). */
test.describe("product card — the cheapest volume rule", () => {
  desktopOnly();

  test("every multi-volume card in a listing prints its cheapest volume's price", async ({ page }) => {
    const wrong: string[] = [];
    let checked = 0;

    /* Two listings, one verdict. The catalogue grid is the ordinary shelf;
       the search screen reaches past the first twelve of a category, where
       most of the Kevin.Murphy and Davines bottles live. Both, so a card that
       goes wrong on only one screen still has somewhere to be caught. */
    for (const [url, screen] of [["/search/?q=RE.STORE", "search"], ["/c/hair/", "catalog"]] as const) {
      await page.goto(shopUrl("", url));
      await waitForScreen(page, screen);
      await expect(page.locator(".grid .card").first()).toBeVisible();

      const printed = await page.locator(".grid .card").evaluateAll((cards) =>
        cards.map((c) => ({
          id: c.querySelector("[data-go-product]")?.getAttribute("data-go-product") ?? "",
          // textContent, not innerText — `content-visibility: auto` leaves a
          // card below the fold with no *rendered* text to read
          text: (c.querySelector(".card__price") as HTMLElement | null)?.textContent?.trim() ?? "",
        })));

      for (const { id, text } of printed) {
        const v = VARIANTS[id];
        if (!v || v.prices.length < 2) continue;   // one volume — nothing to choose between
        /* A price that is none of this product's known volumes is a price the
           admin panel overrode (the goods-editor sweep edits five sampled
           products), not a card picking the wrong volume — skip it. The bug
           this test is for always lands ON one of these numbers, so it can
           never be skipped away. */
        if (!v.prices.some((p) => eur(p, "RU") === text)) continue;
        const cheap = cheapest(id);
        checked++;
        if (text !== eur(cheap.price, "RU")) {
          wrong.push(`${url} ${id}: card says «${text}», cheapest of ${JSON.stringify(v.prices)} is ${eur(cheap.price, "RU")}`);
        }
      }
    }

    expect(wrong, "card(s) not showing the cheapest volume's price").toEqual([]);
    expect(checked, "no multi-volume card was checked — the sweep would be vacuous").toBeGreaterThan(5);
    /* There used to be a third assertion here, that at least one product in
       the sweep had its cheapest volume somewhere other than first — without
       it a card that simply took sizes[0] would pass. It went when the
       catalogue's own pairing was repaired and that stopped being true of any
       product. The claim it defended is now made directly, and over the whole
       table rather than whatever two listings happen to render:
       tests/catalogue-variants.test.ts. */
  });

  test("no hairline under a card any more", async ({ page }) => {
    await page.goto(shopUrl("", "/c/hair/"));
    await waitForScreen(page, "catalog");
    await expect(page.locator("#catgrid .card").first()).toBeVisible();

    /* The rule the owner cut on 09.09.2026: «the add to cart button already
       has it». Worth a test of its own because the line was drawn by a
       `.card::after` that markLastRows() switched off row by row — it
       measured every card after every paint, so a stylesheet that brings the
       pseudo-element back gets a line under every card and nothing left to
       turn it off. */
    const line = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#catgrid .card"))
        .map((c) => getComputedStyle(c, "::after").content)
        .filter((c) => c && c !== "none"));
    expect(line, ".card::after is drawing something again").toEqual([]);
    expect(await page.locator(".card--last").count(), "markLastRows() is back").toBe(0);
  });
});

/* The viewport-sensitive half of the card, and the reason the desktop-only
 * guard sits in the describes above rather than at the top of the file: a
 * card is a 150px grid track on a 375px phone against 200px on a laptop, and
 * everything the owner asked for on 09.09.2026 — a name clamped to two lines
 * so «everything is on same height», a foot of two rows instead of one, the
 * full «Lisa ostukorvi» in place of the shortened label — is a size the phone
 * has least room for. An overflowing card there gives the whole page a
 * sideways scroll, which is what the picker's own layout test used to guard
 * and what must not be lost with it. Geometry, not text, so one language is
 * enough (docs/testing.md). Run it with `--project=mobile` as well as
 * desktop. */
test.describe("product card — layout", () => {
  // /c/merch/ is the worst case on purpose: a t-shirt's name and its ten
  // «colour / size» variants are the longest strings in the catalogue.
  // /c/hair/ is the ordinary case.
  for (const cat of ["hair", "merch"]) {
    test(`every card in /c/${cat}/ is one height, its foot lines up, and the page never scrolls sideways`, async ({ page }) => {
      await page.goto(shopUrl("", `/c/${cat}/`));
      await waitForScreen(page, "catalog");
      await expect(page.locator("#catgrid .card").first()).toBeVisible();

      const report = await page.evaluate(async () => {
        const grid = document.getElementById("catgrid")!;
        /* Hold the nodes before scrolling: the scroll below reaches the
           infinite-scroll sentinel and patchCatalog() may append a further
           twelve behind our back — those are not what was measured. */
        const cards = Array.from(grid.querySelectorAll<HTMLElement>(".card"));
        /* styles.css gives every card `content-visibility: auto` with a
           `contain-intrinsic-size` of 340px, so a card that has never been
           near the viewport reports that placeholder instead of its real
           height and "every card is the same height" would fail on the
           bottom row for a reason that is not a bug. One pass down the page
           lays them all out for good. */
        for (let y = 0; y <= document.documentElement.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const escaped: string[] = [];
        const heights = new Set<number>();
        const rows = new Map<number, Array<{ price: number; add: number }>>();
        cards.forEach((card, i) => {
          const c = card.getBoundingClientRect();
          const name = card.querySelector<HTMLElement>(".card__name");
          const price = card.querySelector<HTMLElement>(".card__price");
          const add = card.querySelector<HTMLElement>(".card__add");
          if (!name || !price || !add) {
            escaped.push(`card ${i}: name=${!!name} price=${!!price} add=${!!add}`);
            return;
          }
          heights.add(Math.round(c.height));
          const p = price.getBoundingClientRect(), a = add.getBoundingClientRect();
          const foot = card.querySelector<HTMLElement>(".card__foot")!.getBoundingClientRect();
          const id = card.querySelector("[data-go-product]")?.getAttribute("data-go-product") ?? `card ${i}`;
          // the foot has to stay inside the track it was given, and the link
          // must not be cut off (it is one line, `white-space: nowrap`)
          if (foot.right > c.right + 1 || foot.left < c.left - 1 || add.scrollWidth > add.clientWidth + 1) {
            escaped.push(`${id}: foot ${Math.round(foot.left)}…${Math.round(foot.right)} sw${add.scrollWidth}/cw${add.clientWidth}` +
              ` vs card ${Math.round(c.left)}…${Math.round(c.right)}`);
          }
          // two rows, in that order — the price above, the link below
          if (a.top < p.bottom) escaped.push(`${id}: «В корзину» sits on top of the price`);
          const key = Math.round(c.top + window.scrollY);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key)!.push({ price: p.top + window.scrollY, add: a.top + window.scrollY });
        });

        const ragged = Array.from(rows.entries())
          .map(([top, cells]) => {
            const spread = (k: "price" | "add") => Math.max(...cells.map((c) => c[k])) - Math.min(...cells.map((c) => c[k]));
            return { top, n: cells.length, price: spread("price"), add: spread("add") };
          })
          .filter((r) => r.price > 1 || r.add > 1)
          .map((r) => `row at ${r.top} (${r.n} cards): price tops differ by ${r.price.toFixed(2)}px, add tops by ${r.add.toFixed(2)}px`);

        return {
          escaped, ragged,
          cards: cards.length,
          rows: rows.size,
          heights: Array.from(heights),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });

      expect(report.cards, "no cards rendered — the check would be vacuous").toBeGreaterThan(0);
      expect(report.escaped, "card foot / add link out of its card").toEqual([]);
      /* More than one row, or "every card is the same height" is a statement
         about one row that the grid's own `align-items: stretch` guarantees
         for free — the clamp on .card__name is what makes two DIFFERENT rows
         agree, and that is the regression worth catching. */
      expect(report.rows, "only one row of cards — same-height would prove nothing").toBeGreaterThan(1);
      expect(report.heights, "cards in this grid are not all the same height (.card__name lost its two-line clamp?)")
        .toHaveLength(1);
      expect(report.ragged, "the price / «В корзину» rows of one grid row do not line up").toEqual([]);
      expect(report.scrollWidth, "the catalogue must not scroll sideways").toBeLessThanOrEqual(report.clientWidth + 1);
    });
  }
});
