/**
 * The three looks of a home-banner slide (Dim, 02.11.2026 — the design in
 * Rempire/canvas-banner): «Фото на всю ширину» (wide), «Фото на половину»
 * (half) and «Товар» (product), with a focus point, a side for the words and
 * the picture's size.
 *
 * Three things are pinned here:
 *   1. what the server stores (src/lib/hero.ts cleanHeroSetting — PUT
 *      /api/admin/settings) and what the assistant may send (sanitizeHero);
 *   2. how a slide that says nothing about its look is read — every banner
 *      stored before this has none, and nothing was migrated;
 *   3. that public/shop2/app.js carries the SAME rules: the storefront and the
 *      panel decide the look in the browser, the server in TypeScript, and a
 *      table run through both is the only thing that keeps them one rule.
 *      The functions are cut out of app.js by source text, so what is checked
 *      is the code that ships.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import {
  cleanHeroFocus,
  cleanHeroSetting,
  heroKindForUpload,
  heroKindOf,
  heroKindOfImage,
  heroLayout,
} from "@/lib/hero";
import { briefHero, sanitizeAction, sanitizeHero } from "@/app/api/assistant/actions";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function fn(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}
function decl(marker: string): string {
  const at = app.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  return app.slice(at, app.indexOf(";", at) + 1);
}

const known = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
const someId = (catalogueMin as Array<{ id: string }>)[0].id;

/** The storefront's own look functions, run as the browser runs them. */
const shop = new Function(`
  ${decl("var HERO_KINDS = ")}
  ${decl("var HERO_WIDE_RATIO = ")}
  ${fn("esc")}
  ${fn("heroUrl")}
  ${fn("heroKindOfImage")}
  ${fn("heroKind")}
  ${fn("heroKindForUpload")}
  ${fn("heroSide")}
  ${fn("heroFocus")}
  ${fn("heroPos")}
  ${fn("heroPx")}
  ${fn("heroImg")}
  function heroT(f) { return String((f && f.RU) || ""); }
  function heroHref() { return "/c/all/"; }
  function heroGoAttr() { return 'data-go-cat="all"'; }
  function heroArt(image, cls, o, s) { return '<span class="hero__art" data-art="' + esc(image) + '"></span>'; }
  ${fn("chevron")}
  ${fn("heroFrameHTML")}
  ${decl("var HERO_ARROWS = ")}
  ${fn("heroArrowLabel")}
  ${fn("heroBandHTML")}
  ${fn("heroSlideHTML")}
  return { heroKindOfImage, heroKind, heroKindForUpload, heroSide, heroFocus, heroImg, heroSlideHTML, heroBandHTML, HERO_ARROWS };
`)() as {
  heroKindOfImage: (image: unknown) => string;
  heroKind: (s: unknown) => string;
  heroKindForUpload: (w: unknown, h: unknown) => string;
  heroSide: (s: unknown) => string;
  heroFocus: (s: unknown) => { x: number; y: number };
  heroImg: (s: unknown, sizes: string, first: boolean, flat: boolean, noPos?: boolean) => string;
  heroSlideHTML: (s: unknown, i: number, cur: number, flat: boolean) => string;
  heroBandHTML: (label: string, slides: string[], kind: string, cur: number, names: string[]) => string;
  HERO_ARROWS: string[];
};

/** The panel's own cleaner — what it sends as settings.hero. */
const panelClean = new Function(`
  ${decl("var HERO_KINDS = ")}
  var HERO_TICK = 6000;
  ${fn("heroPx")}
  ${fn("heroClean")}
  return heroClean;
`)() as (d: unknown) => { slides: Array<Record<string, unknown>>; interval: number };

const BUCKET = "https://img.rempireshop.com";
/* Every kind of picture a slide holds on the live shop and in the panel, and
   the look it has always been drawn with. The five live slides of 02.11.2026
   are the first five: three of Renat's own photos, two catalogue products. */
const PICTURES: Array<[image: string, kind: "wide" | "half" | "product", why: string]> = [
  [`${BUCKET}/hero/1793398693162-bc708cfe-efaf-4b70-b15c-dac6f41045e7.webp`, "half", "Renat's own photo (3:4)"],
  [`${BUCKET}/hero/1793397001638-90ce9461033b338b6f78c1f6dd61ea26.webp`, "half", "Renat's own photo (3:4)"],
  [`${BUCKET}/hero/1793399141651-1486455f-85a4-4210-a43e-f6d50d1910ce.webp`, "half", "Renat's own photo (1:1)"],
  ["xerjoff-tony-iommi-monkey-special-50ml", "product", "a catalogue product by id"],
  ["handmade-soap-666", "product", "a catalogue product by id"],
  ["gift", "product", "the gift card's mark"],
  ["", "product", "no picture (falls back to a catalogue photo)"],
  ["/shop/img/handmade-soap-666-0.webp", "product", "a catalogue photo by address"],
  [`${BUCKET}/products/c-abc/1700000000000-photo.webp`, "product", "a product photo from the bucket"],
  [`${BUCKET}/products/touchable/1700000000000-photo-cutout.png`, "product", "a gallery cut-out"],
  [`${BUCKET}/hero/1700000000000-bottle-cutout.webp`, "product", "a banner cut-out"],
  [`${BUCKET}/hero/1700000000000-bottle-cutout.webp?v=2`, "product", "a cut-out with a query"],
  ["https://cdn.example.com/campaign/beard.jpg", "half", "a pasted photo"],
  ["/og-shop.png", "half", "a site photo by path"],
  ["javascript:alert(1)", "product", "not a picture address at all"],
  ["https://cdn.example.com/a b.jpg", "product", "an address with a space"],
];

describe("a slide that says nothing about its look (every banner stored before 02.11.2026)", () => {
  for (const [image, kind, why] of PICTURES) {
    it(`${why} → ${kind}`, () => {
      expect(heroKindOfImage(image)).toBe(kind);
      expect(heroKindOf({ image })).toBe(kind);
      // …and the storefront reads it the same way
      expect(shop.heroKindOfImage(image), "app.js disagrees with src/lib/hero.ts").toBe(kind);
      expect(shop.heroKind({ image }), "app.js disagrees with src/lib/hero.ts").toBe(kind);
    });
  }
});

describe("a slide's own kind", () => {
  const photo = `${BUCKET}/hero/1700000000000-x.webp`;
  it("is what a photograph is drawn with", () => {
    for (const kind of ["wide", "half", "product"]) {
      expect(heroKindOf({ image: photo, kind })).toBe(kind);
      expect(shop.heroKind({ image: photo, kind })).toBe(kind);
    }
  });
  it("cannot make a catalogue product or the gift card fill the band", () => {
    for (const image of [someId, "gift", ""]) {
      expect(heroKindOf({ image, kind: "wide" })).toBe("product");
      expect(shop.heroKind({ image, kind: "half" })).toBe("product");
    }
  });
  it("falls back to the picture when it is not one of the three", () => {
    expect(heroKindOf({ image: photo, kind: "banner" })).toBe("half");
    expect(shop.heroKind({ image: photo, kind: "WIDE" })).toBe("half");
  });
});

describe("the kind an upload picks by itself", () => {
  const table: Array<[w: unknown, h: unknown, kind: string]> = [
    [1600, 900, "wide"],
    [1300, 1000, "wide"], // exactly 1.3
    [1299, 1000, "half"],
    [1024, 1024, "half"],
    [1024, 1360, "half"], // Renat's upright photos
    [0, 900, "half"],
    [undefined, undefined, "half"],
    ["1600", "900", "wide"],
    [Number.NaN, 10, "half"],
  ];
  for (const [w, h, kind] of table) {
    it(`${String(w)} × ${String(h)} → ${kind}`, () => {
      expect(heroKindForUpload(w, h)).toBe(kind);
      expect(shop.heroKindForUpload(w, h), "app.js disagrees with src/lib/hero.ts").toBe(kind);
    });
  }
});

describe("cleanHeroSetting — what PUT /api/admin/settings stores as settings.hero", () => {
  const slide = {
    id: "s1",
    eyebrow: { RU: "Борода" },
    title: { RU: "Всё для формы", ET: "Kõik vormi jaoks", EN: "Keep it in shape" },
    sub: {},
    cta: { RU: "В каталог" },
    go: "cat:beard",
    image: `${BUCKET}/hero/1700000000000-x.webp`,
    on: true,
  };

  it("keeps «стандартный» as null and turns anything that is not a banner into it", () => {
    expect(cleanHeroSetting(null)).toBeNull();
    for (const v of [undefined, "hero", 42, [slide], {}, { slides: "nope" }]) expect(cleanHeroSetting(v)).toBeNull();
  });

  it("keeps «no banner at all» — an empty list is not the default", () => {
    expect(cleanHeroSetting({ slides: [], interval: 6000 })).toEqual({ slides: [], interval: 6000 });
  });

  it("hands an old slide back exactly as it was — no look is invented for it", () => {
    expect(cleanHeroSetting({ slides: [slide], interval: 6000 })).toEqual({ slides: [slide], interval: 6000 });
  });

  it("keeps a valid look", () => {
    const look = { kind: "wide", side: "right", focus: { x: 0.25, y: 0.7 }, w: 1600, h: 900 };
    const out = cleanHeroSetting({ slides: [{ ...slide, ...look }], interval: 6000 })!;
    expect(out.slides[0]).toEqual({ ...slide, ...look });
  });

  it("drops a look the storefront cannot draw, field by field", () => {
    const out = cleanHeroSetting({
      slides: [{ ...slide, kind: "banner", side: "top", focus: { x: 2, y: 0.5 }, w: 1600 }],
      interval: 6000,
    })!;
    expect(out.slides[0]).toEqual(slide);
    expect(heroLayout({ focus: { x: "0.5", y: 0.5 } })).toEqual({});
    expect(heroLayout({ w: 1.5, h: 900 })).toEqual({});
    expect(heroLayout({ w: 99999, h: 900 })).toEqual({});
    expect(cleanHeroFocus({ x: 0.12345, y: 1 })).toEqual({ x: 0.123, y: 1 });
    expect(cleanHeroFocus({ x: Number.NaN, y: 0 })).toBeUndefined();
  });

  it("drops unknown keys, keeps five slides, clamps the interval", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...slide, id: `s${i + 1}`, script: "<img onerror=1>" }));
    const out = cleanHeroSetting({ slides: many, interval: 50, extra: true })!;
    expect(Object.keys(out).sort()).toEqual(["interval", "slides"]);
    expect(out.slides).toHaveLength(5);
    expect(out.slides[0]).not.toHaveProperty("script");
    expect(out.interval).toBe(2000);
    expect(cleanHeroSetting({ slides: [slide], interval: 1e9 })!.interval).toBe(30_000);
  });

  it("is what the panel itself sends — the stored banner and the panel's copy are one document", () => {
    const draft = {
      slides: [
        { ...slide, kind: "wide", side: "center", focus: { x: 0.3333333, y: 0.5 }, w: 1600, h: 900 },
        { ...slide, id: "s2", image: someId, kind: "nonsense", focus: { x: -1, y: 0 } },
        { ...slide, id: "s3", title: { RU: "  с пробелами  " }, w: 800 },
      ],
      interval: 7000,
    };
    const sent = panelClean(draft);
    expect(cleanHeroSetting(sent)).toEqual(sent);
    expect(sent.slides[0]).toMatchObject({ kind: "wide", side: "center", focus: { x: 0.333, y: 0.5 }, w: 1600, h: 900 });
    expect(sent.slides[1]).not.toHaveProperty("kind");
    expect(sent.slides[1]).not.toHaveProperty("focus");
    expect(sent.slides[2]).not.toHaveProperty("w");
  });
});

describe("«Помощник» keeps the look — set_hero and the banner it is shown", () => {
  const slide = {
    id: "s1",
    eyebrow: { RU: "Борода", ET: "Habe", EN: "Beard" },
    title: { RU: "Всё для формы", ET: "Kõik vormi jaoks", EN: "Keep it in shape" },
    sub: { RU: "Масла и бальзамы.", ET: "Õlid ja palsamid.", EN: "Oils and balms." },
    cta: { RU: "В каталог", ET: "Kataloogi", EN: "Browse" },
    go: "cat:beard",
    image: `${BUCKET}/hero/1700000000000-x.webp`,
    on: true,
  };

  it("lets the model set a kind, a side and a focus point", () => {
    const look = { kind: "wide", side: "right", focus: { x: 0.4, y: 0.6 }, w: 1600, h: 900 };
    const out = sanitizeAction({ type: "set_hero", value: { slides: [{ ...slide, ...look }], interval: 6000 } }, known, true) as {
      value: { slides: Array<Record<string, unknown>> };
    };
    expect(out.value.slides[0]).toEqual({ ...slide, ...look });
  });

  it("drops a look that is not one, and adds none to a slide that had none", () => {
    const out = sanitizeHero({ slides: [{ ...slide, kind: "huge", side: "middle", focus: "centre" }] }, known) as {
      slides: Array<Record<string, unknown>>;
    };
    expect(out.slides[0]).toEqual(slide);
  });

  it("shows the model each slide's look, so a slide it copies keeps it", () => {
    const look = { kind: "half", focus: { x: 0.5, y: 0.45 }, w: 1024, h: 1360 };
    expect(briefHero([{ ...slide, ...look }])[0]).toEqual({ ...slide, ...look });
    expect(briefHero([{ ...slide, kind: "<script>" }])[0]).toEqual(slide);
  });

  it("is told what the kinds are", () => {
    const route = readFileSync(fileURLToPath(new URL("../src/app/api/assistant/route.ts", import.meta.url)), "utf8");
    for (const word of ["- kind —", '"wide"', '"half"', '"product"', "- side —", "- focus —", "«Фото на всю ширину»"]) {
      expect(route, `the set_hero instructions lost ${word}`).toContain(word);
    }
  });

  it("is sent the look by the panel (heroForAI)", () => {
    const run = new Function("SLIDES", `
      function heroConf() { return { slides: SLIDES, interval: 6000 }; }
      ${fn("heroForAI")}
      return heroForAI();
    `) as (slides: unknown[]) => Array<Record<string, unknown>>;
    const look = { kind: "wide", side: "center", focus: { x: 0.2, y: 0.8 }, w: 1600, h: 900 };
    expect(run([{ ...slide, ...look }])[0]).toMatchObject(look);
    expect(run([slide])[0]).not.toHaveProperty("kind");
  });
});

describe("the storefront's slide, per kind", () => {
  const base = {
    id: "s1", eyebrow: { RU: "Борода" }, title: { RU: "Всё для формы" }, sub: { RU: "Масла." }, cta: { RU: "В каталог" },
    go: "cat:beard", on: true,
  };
  const photo = `${BUCKET}/hero/1700000000000-x.webp`;

  it("draws a full-width photo as its own layer, cropped by the focus point, with the side on the slide", () => {
    const html = shop.heroSlideHTML({ ...base, image: photo, kind: "wide", side: "right", focus: { x: 0.25, y: 0.7 } }, 0, 0, false);
    expect(html).toContain('class="hero__slide hero__slide--wide hero__slide--right"');
    expect(html).toContain('data-kind="wide"');
    expect(html).toContain('<span class="hero__photo"><img src="' + photo + '"');
    expect(html).toContain('style="object-position:25% 70%"');
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('<h2 class="hero__title">Всё для формы</h2>');
    expect(html).toContain('<a class="btn" href="/c/all/"');
  });

  it("loads only the slide the page opens on first", () => {
    const second = shop.heroSlideHTML({ ...base, image: photo, kind: "half" }, 1, 0, false);
    expect(second).toContain('loading="lazy"');
    expect(second).not.toContain("fetchpriority");
    expect(second).toContain('aria-hidden="true"');
  });

  it("offers the upload's small copy when the size is known, and only then", () => {
    const sized = shop.heroImg({ image: photo, w: 1024, h: 1360 }, "(min-width: 768px) 62vw, 100vw", true, false);
    expect(sized).toContain(`srcset="${BUCKET}/hero/1700000000000-x-thumb.webp 301w, ${photo} 1024w"`);
    expect(sized).toContain('sizes="(min-width: 768px) 62vw, 100vw"');
    expect(sized).toContain('width="1024" height="1360"');
    expect(shop.heroImg({ image: photo }, "100vw", true, false)).not.toContain("srcset");
    // a picture that is not one of the bucket's banner uploads has no small copy to offer
    expect(shop.heroImg({ image: "https://cdn.example.com/x.webp", w: 1600, h: 900 }, "100vw", true, false)).not.toContain("srcset");
    // …and one already small has nothing smaller
    expect(shop.heroImg({ image: photo, w: 400, h: 300 }, "100vw", true, false)).not.toContain("srcset");
  });

  it("keeps the cut-out slide it always was — the words, then the picture", () => {
    const html = shop.heroSlideHTML({ ...base, image: someId }, 0, 0, false);
    expect(html).toContain('class="hero__slide hero__slide--product"');
    expect(html).toContain('<div class="hero__box"><div class="hero__inner">');
    expect(html).toContain(`data-art="${someId}"`);
    expect(html).not.toContain("hero__photo");
  });

  it("defaults the side to the left and the focus to the middle", () => {
    expect(shop.heroSide({})).toBe("left");
    expect(shop.heroSide({ side: "up" })).toBe("left");
    expect(shop.heroFocus({})).toEqual({ x: 0.5, y: 0.5 });
    expect(shop.heroFocus({ focus: { x: 3, y: 0 } })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("asks for a «half» photo no wider than the shop's column it stands in", () => {
    const html = shop.heroSlideHTML({ ...base, image: `${BUCKET}/hero/1700000000000-x.webp`, kind: "half", w: 1024, h: 1360 }, 0, 0, false);
    expect(html).toContain('sizes="(min-width: 1240px) 769px, (min-width: 768px) 62vw, 100vw"');
  });
});

/* Dim, 02.11.2026: the dots under the banner had come back by mistake —
   they go, on every screen; the arrows and the swipe stay, and the arrows
   say where they lead and how many there are. */
describe("the band around the slides", () => {
  const slides = ["<i>1</i>", "<i>2</i>", "<i>3</i>"];

  it("draws two arrows and no dots", () => {
    const html = shop.heroBandHTML("Баннеры", slides, "half", 0, shop.HERO_ARROWS);
    expect(html).toMatch(/^<section class="hero" aria-label="Баннеры" aria-roledescription="карусель" data-kind="half">/);
    expect(html.match(/class="hero__arrow /g)).toHaveLength(2);
    expect(html).not.toContain("hero__dot");
    expect(html).not.toContain("data-slideto");
    expect(app).not.toContain("hero__dot");
  });

  it("says in each arrow which slide it goes to, of how many", () => {
    const html = shop.heroBandHTML("Баннеры", slides, "half", 0, shop.HERO_ARROWS);
    expect(html).toContain('data-slide="-1" aria-label="Предыдущий баннер — 3 из 3"');
    expect(html).toContain('data-slide="1" aria-label="Следующий баннер — 2 из 3"');
    const last = shop.heroBandHTML("Баннеры", slides, "half", 2, shop.HERO_ARROWS);
    expect(last).toContain('aria-label="Следующий баннер — 1 из 3"');
    // …and the dictionary says it in Estonian and English, the arrow's name its own entry
    expect(app).toContain('"Следующий баннер": "Järgmine bänner"');
    expect(app).toContain(
      '[/^(Предыдущий баннер|Следующий баннер|Предыдущая статья|Следующая статья) — (\\d+) из (\\d+)$/,\n' +
      '      { ET: "$1 — $2 / $3", EN: "$1 — $2 of $3" }],');
  });

  it("draws one slide as a picture: no arrows", () => {
    expect(shop.heroBandHTML("Баннеры", slides.slice(0, 1), "wide", 0, shop.HERO_ARROWS)).not.toContain("hero__arrow");
  });
});

/* The band's own measures (Dim, 02.11.2026, measured at 1440: 594 px was too
   tall, and the photos were blown up past their pixels). */
describe("styles.css — the band's heights and the photo's frame", () => {
  const css = readFileSync(fileURLToPath(new URL("../public/shop2/styles.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

  it("is ~440 px on a computer and a 4:3 photo plus the words on a phone", () => {
    expect(css).toContain("--hero-h: clamp(360px, 30vw, 440px);");
    expect(css).toContain("--hero-ph: calc(min(100vw, 480px) * .75);");
    expect(css).toContain("--hero-hm: calc(var(--hero-ph) + 190px);");
  });

  it("keeps the «half» photo inside the shop's column, and never draws a cut-out larger than its file", () => {
    expect(css).toMatch(/\.hero__slide--half \.hero__photo \{\n\s+position: absolute; top: 0; bottom: 0;\n\s+right: max\(0px, \(100% - var\(--maxw\)\) \/ 2\);\n\s+width: calc\(min\(100%, var\(--maxw\)\) \* \.62\);/);
    expect(css).toMatch(/\.hero__slide--product \.hero__art > img \{\n\s+inset: 0; margin: auto; width: auto; height: auto; max-width: 100%; max-height: 100%;/);
    expect(css).not.toContain(".hero__dot");
  });
});
