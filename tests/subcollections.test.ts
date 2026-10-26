/**
 * Subcollections — an existing chip with a page of its own, at the handle
 * Shopify had for it (SEO audit 08.10.2026, §6.2, §7.1 and T6; Dim, 09.10.2026:
 * pages for the chips that are there, and nothing on the chip row changes).
 *
 * Who is under which chip is ONE function, subcatsAuto() in
 * public/shop2/app.js, beside the chips that use it; tools/prerender-shop2.mjs
 * lifts it out of that file by its first and last lines (with SUBCATS and
 * subcatsWith), and so does this test, the same way — so what is held here is
 * what the chips filter and what the static pages list. A page's words are
 * seoSub() / seoHead("sub") in src/lib/seo-copy.mjs.
 *
 * Since 26.10.2026 the chip is the product's OWN — `sub` in catalogue2.js
 * (`sb` in catalogue.min.json), the owner's «Подраздел» over it — one per
 * product, never read off the name (Dim: «they are there for SEO and should
 * not use some kind of keywords»). It was seeded from the name rules that
 * placed every product until then, which this test still writes out (BASE,
 * ADDED): every product keeps the chip they gave it, the four aftershave
 * balms keep «После бритья» alone, and a rename moves nothing. No minimum
 * count: an empty subcollection keeps its page, noindex, out of the sitemap.
 *
 * The addresses are SUB_HANDLES in src/lib/shop-paths.mjs (and its ES5 twin
 * SHOP_SUB_HANDLES in app.js); the old Shopify spellings move in one hop
 * (src/lib/legacy-redirects.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { legacyTarget } from "@/lib/legacy-redirects";
import { isKnownShopPath } from "@/lib/notfound-page";
import { seoCopy, seoHead, seoSub } from "@/lib/seo-copy.mjs";
import { headLinks, langBySeg, sitemapUrlEntry } from "@/lib/seo-head.mjs";
import {
  isSubcollection,
  parseShopPath,
  publicPath,
  SUB_HANDLES,
  subOfHandle,
} from "@/lib/shop-paths.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = readFileSync(ROOT + "public/shop2/app.js", "utf8").replace(/\r\n?/g, "\n");
const LINES = APP.split("\n");
const LANGS = ["EN", "RU", "ET"] as const;
type Lang = (typeof LANGS)[number];

/* ---- the lift, exactly as tools/prerender-shop2.mjs does it ----------------- */
const DECL_END = /^ {2}[}\]];$/;
const FN_END = /^ {2}}$/;
function sliceFrom(startRx: RegExp, endRx: RegExp): string | null {
  const i = LINES.findIndex((l) => startRx.test(l));
  if (i < 0) return null;
  for (let j = i + 1; j < LINES.length; j++) if (endRx.test(LINES[j])) return LINES.slice(i, j + 1).join("\n");
  return null;
}
type Def = { id: string; name: string; re: RegExp };
type Words = { name: string; title: string; meta: string; intro: string };
type Product = { id: string; name: string; cat: string; brand: string; sub?: string };
const PIECES = [
  sliceFrom(/^ {2}var SUBCATS = \{$/, DECL_END),
  sliceFrom(/^ {2}function subcatsAuto\(p\) \{$/, FN_END),
  sliceFrom(/^ {2}function subcatsWith\(p, own\) \{$/, FN_END),
];
// the name rules' one remaining job — a NEW product's first suggestion (not lifted by the prerender)
const SUGGEST = sliceFrom(/^ {2}function subcatSuggest\(p\) \{$/, FN_END);
const ctx: Record<string, unknown> = {};
runInNewContext(
  PIECES.join("\n") + "\n" + SUGGEST +
    "\nthis.SUBCATS = SUBCATS; this.auto = subcatsAuto; this.withOwn = subcatsWith; this.suggest = subcatSuggest;",
  ctx,
);
const SUBCATS = ctx.SUBCATS as Record<string, Def[]>;
/* each published subcollection's words, by language — seoSub() */
const SUB_PAGES = Object.fromEntries(Object.keys(SUB_HANDLES).map((k) =>
  [k, Object.fromEntries(LANGS.map((L) => [L, seoSub(k, L) as Words]))])) as Record<string, Record<Lang, Words>>;
const auto = ctx.auto as (p: Product) => string[];
const withOwn = ctx.withOwn as (p: Product, own: string) => string[];
const suggest = ctx.suggest as (p: Product) => string;

/* The catalogue the prerender reads (public/shop/catalogue2.js) and the one
   the edge reads (src/data/catalogue.min.json) — the same 220 products. */
const CATALOGUE = new Function(readFileSync(ROOT + "public/shop/catalogue2.js", "utf8") + "\nreturn CATALOGUE;")() as Product[];
const MIN = (catalogueMin as Array<{ id: string; n: string; c: string; b: string; sb?: string }>)
  .map((p) => ({ id: p.id, name: p.n, cat: p.c, brand: p.b, sub: p.sb }));

/* ---- the chip row of main, word for word ----------------------------------- */
const BASE: Record<string, Array<[string, string, RegExp]>> = {
  hair: [["sh", "Шампуни", /шампунь/i], ["co", "Кондиционеры", /кондиционер/i], ["ca", "Маски и уход", /маск|сыворотк|тоник|уход/i], ["sp", "Спреи", /спрей/i]],
  styling: [["pw", "Пасты и воски", /паста|воск/i], ["sp", "Спреи", /спрей/i], ["ge", "Гели", /гель/i], ["pu", "Пудры", /пудр/i]],
  beard: [["oi", "Масла", /масло/i], ["ba", "Бальзамы", /бальзам/i], ["af", "После бритья", /лосьон|после бритья/i], ["ge", "Гели", /гель/i]],
  face: [["to", "Тонеры", /тоник|тонер/i], ["cl", "Очищение", /очища|пенка|мыло/i], ["cs", "Кремы и сыворотки", /крем|сыворотк/i], ["oi", "Масла", /масло/i]],
};
const baseChips = (p: Product) => (BASE[p.cat] || []).filter(([, , re]) => re.test(p.name)).map(([id]) => id);

/* Products no chip showed before, and the one chip each is under now — every
   label plainly what the product is (the maker's own words in brackets). */
/* Since 09.10.2026 six Kevin.Murphy names carry the maker's type («Hair.Resort.Spray —
   текстурирующий спрей», «RE.STORE / SMOOTH.AGAIN / LEAVE-IN.REPAIR — … уход», «Super.Goo —
   моделирующий гель», «KILLER.WAVES — спрей для локонов»), so the chip they were ADDED to
   now finds them by name like any other product; same chip, no longer listed here. */
const ADDED: Record<string, string> = {
  "davines-naturaltech-nourishing-keratin-booster-100ml": "ca", // intensive repair treatment
  "kevin-murphy-night-shift-100ml": "ca",                       // overnight leave-in serum («масло»)
  "kevin-murphy-young-again-oil": "ca",                         // leave-in treatment oil
  "heated-defense": "ca",                                       // leave-in heat-protection treatment
  "paul-mitchell-curl-full-circle-leave-in-cream": "ca",        // leave-in cream
  "system-4-moisture-scalp-lotion-m": "ca",                     // leave-in scalp treatment
  "gatsby-moving-rubber-wild-shake-15g": "pw",                  // Moving Rubber hair wax
  "davines-medium-hold-styling-paste": "pw",                    // styling paste
  "davines-pasta-love-strong-hold-mat-clay": "pw",              // mat clay
  "paul-mitchell-clear-styling-glaze": "ge",                    // styling gel
  "davines-pre-shaving-beard-oil": "oi",                        // pre-shaving & beard oil
  "cosrx-low-ph-good-morning-gel-cleanser": "cl",               // gel cleanser
  "lumin-skin-charcoal-scrub-deep-detox": "cl",                 // face scrub
  "lumin-skin-charcoal-face-wash-daily-detox": "cl",            // face wash
  "cosrx-advanced-snail-96-mucin-power-essence": "cs",          // essence
};
/* …and the ones still under no chip, on purpose: no label on their row says
   what they are (a paste filed under hair care, a styling cream, a mousse,
   a moustache wax, a sheet mask). */
const IN_NONE = [
  "night-rider", "free-hold", "rough-rider", "kevin-murphy-motion-lotion",
  "paul-mitchell-curl-quick-slip-styling-cream", "paul-mitchell-curl-hydrating-foam",
  "kevin-murphy-killer-twirls", "easy-rider", "killer-curls", "body-builder", "paul-mitchell-super-skinny-serum",
  "kevin-murphy-full-again", "hair-resort", "anti-gravity",
  "captain-fawcett-nebula-moustache-wax", "captain-fawcett-ricki-hall-booze-baccy-moustache-wax", "captain-fawcett-barberism-moustache-wax",
  "gummy-sheet-mask-madecassoside-sticker", "cosrx-advanced-snail-hydrogel-eye-patch-60pcs", "laneige-cica-sleeping-mask",
  "real-nature-green-tea-mask-sheet",
];

describe("the lift — what tools/prerender-shop2.mjs takes out of app.js", () => {
  it("finds every slice, each closing on a line of its own", () => {
    expect(PIECES.every(Boolean)).toBe(true);
    expect(SUGGEST).toBeTruthy();
    expect(APP).not.toContain("var SUB_PICKS");
    expect(Object.keys(SUBCATS).sort()).toEqual(["beard", "face", "hair", "styling"]);
  });
});

describe("the chip row is the one the shop had — same chips, same labels, same rules", () => {
  it("keeps every section's chips, in order, with their labels", () => {
    for (const [cat, chips] of Object.entries(BASE)) {
      expect(SUBCATS[cat].map((d) => [d.id, d.name]), cat).toEqual(chips.map(([id, name]) => [id, name]));
      expect(SUBCATS[cat].map((d) => d.re.source), cat).toEqual(chips.map(([, , re]) => re.source));
    }
  });

  it("translates the labels with the dictionary entries they always had", () => {
    for (const label of ["Шампуни", "Кондиционеры", "Маски и уход", "Спреи", "Пасты и воски", "Гели", "Пудры", "Масла",
      "Бальзамы", "После бритья", "Тонеры", "Очищение", "Кремы и сыворотки"]) {
      expect((APP.match(new RegExp('"' + label + '": "', "g")) || []).length, label).toBe(2);   // ET and EN
    }
    for (const gone of ["Кожа головы", "Корейская косметика", "Бальзамы и воски", "Бритьё"]) expect(APP).not.toContain('"' + gone + '"');
  });
});

describe("subcatsAuto — every product under its own chip, the one the rules gave it on 26.10", () => {
  /* What the name rules said, then one chip: «бальзам после бритья» matched
     Бальзамы and После бритья, and the aftershave balm is an aftershave. */
  const want = (p: Product) => {
    const before = baseChips(p);
    if (before.includes("ba") && before.includes("af")) return ["af"];
    return before.length ? before : ADDED[p.id] ? [ADDED[p.id]] : [];
  };

  it("covers the four sections: what a chip showed before, an ADDED product, or one under none", () => {
    const chipped = CATALOGUE.filter((p) => SUBCATS[p.cat]);
    expect(chipped.length).toBe(183);
    for (const p of chipped) {
      if (!baseChips(p).length) expect(p.id in ADDED || IN_NONE.includes(p.id), p.id).toBe(true);
    }
    for (const id of [...Object.keys(ADDED), ...IN_NONE]) {
      const p = chipped.find((x) => x.id === id);
      expect(p, id).toBeTruthy();
      expect(baseChips(p!), id + " was under a chip before").toEqual([]);
    }
  });

  it.each(CATALOGUE.filter((p) => SUBCATS[p.cat]).map((p) => [p.id, p] as const))("%s", (_id, p) => {
    expect(auto(p)).toEqual(want(p));
  });

  it("is one chip per product, written in the file with its section («beard/af»)", () => {
    for (const p of CATALOGUE) {
      expect(auto(p).length, p.id).toBeLessThanOrEqual(1);
      if (p.sub) expect(p.sub.split("/")[0], p.id).toBe(p.cat);
    }
  });

  it("moves nothing on a rename — the name is not read at all", () => {
    for (const p of CATALOGUE.filter((x) => x.sub)) {
      expect(auto({ ...p, name: "Sensitive Skin" }), p.id).toEqual(auto(p));
      expect(auto({ ...p, name: "Something — шампунь" }), p.id).toEqual(auto(p));
    }
  });

  it("takes a product moved to another section off its chip — the chips are the section's own", () => {
    const p = CATALOGUE.find((x) => x.id === "davines-softening-shaving-gel")!;
    expect(auto(p)).toEqual(["ge"]);
    expect(auto({ ...p, cat: "styling" })).toEqual([]);   // styling has a «Гели» too — not this one's
  });

  it("keeps «После бритья» to the aftershave, the four balms under it alone", () => {
    const af = CATALOGUE.filter((p) => p.cat === "beard" && auto(p).includes("af")).map((p) => p.id);
    expect(af.length).toBe(6);
    for (const id of af) expect(id).toMatch(/after-?shave/);
    expect(CATALOGUE.filter((p) => p.cat === "beard" && auto(p).includes("ba")).every((p) => !/after-?shave/.test(p.id))).toBe(true);
    expect(auto(CATALOGUE.find((p) => p.id === "davines-pre-shaving-beard-oil")!)).toEqual(["oi"]);
    expect(auto(CATALOGUE.find((p) => p.id === "davines-softening-shaving-gel")!)).toEqual(["ge"]);
  });

  it("puts nothing outside the four sections under a chip", () => {
    for (const p of CATALOGUE.filter((x) => !SUBCATS[x.cat])) expect(auto(p), p.id).toEqual([]);
  });

  it("reads the edge's catalogue (catalogue.min.json) the same way — the same `sub` as `sb`", () => {
    for (const p of MIN) {
      const full = CATALOGUE.find((x) => x.id === p.id)!;
      expect(p.sub, p.id).toBe(full.sub);
      expect(auto(p), p.id).toEqual(auto(full));
    }
  });

  it("leaves the same products under no chip — the SEO pass places them (Dim, 26.10)", () => {
    const none = (cat: string) => CATALOGUE.filter((p) => p.cat === cat && !auto(p).length).length;
    expect(none("hair")).toBe(6);
    expect(none("styling")).toBe(8);
    expect(none("beard")).toBe(3);     // the three moustache waxes
    expect(none("face")).toBe(4);      // the masks and the eye patches
  });

  it("gives a product the owner makes himself the chip he picks — none by itself", () => {
    expect(auto({ id: "c-abc", name: "Мятный шампунь", cat: "hair", brand: "Своя марка" })).toEqual([]);
    expect(withOwn({ id: "c-abc", name: "Мятный шампунь", cat: "hair", brand: "Своя марка" }, "sh")).toEqual(["sh"]);
  });
});

describe("subcatSuggest — the name rules, for a NEW product's first choice only", () => {
  it("suggests by the Russian type, the longer match winning", () => {
    expect(suggest({ id: "", name: "Мятный шампунь", cat: "hair", brand: "" })).toBe("sh");
    expect(suggest({ id: "", name: "Масло для бороды «Кедр»", cat: "beard", brand: "" })).toBe("oi");
    expect(suggest({ id: "", name: "Sensitive Skin — бальзам после бритья", cat: "beard", brand: "" })).toBe("af");
    expect(suggest({ id: "", name: "Beard Balm — бальзам для бороды", cat: "beard", brand: "" })).toBe("ba");
  });
  it("falls back on the English words, and suggests nothing it cannot tell", () => {
    expect(suggest({ id: "", name: "Daily Clay", cat: "styling", brand: "" })).toBe("pw");
    expect(suggest({ id: "", name: "Maharajah Moustache Wax", cat: "beard", brand: "" })).toBe("");
    expect(suggest({ id: "", name: "Eau de Parfum", cat: "perfume", brand: "" })).toBe("");
  });
});

describe("the owner's own «Подраздел» wins, exactly as it did", () => {
  const p = CATALOGUE.find((x) => x.id === "system-4-special-shampoo-1")!;
  it("replaces the catalogue's chip with the one he chose, or none («-»)", () => {
    expect(withOwn(p, "")).toEqual(["sh"]);
    expect(withOwn(p, "ca")).toEqual(["ca"]);
    expect(withOwn(p, "-")).toEqual([]);
    // a value no chip has puts the product under none — as the old filter did
    expect(withOwn(p, "zz")).toEqual(["zz"]);
  });
});

describe("publishing — words in three languages, and no minimum count", () => {
  const count = (list: Product[], key: string) => {
    const [cat, sub] = key.split("/");
    return list.filter((p) => p.cat === cat && auto(p).includes(sub)).length;
  };

  it("publishes six existing chips, in both catalogue files", () => {
    // beard/ba was 8 with the four aftershave balms in it too
    expect(Object.fromEntries(Object.keys(SUB_HANDLES).map((k) => [k, count(CATALOGUE, k)]))).toEqual({
      "beard/oi": 12, "beard/ba": 4, "beard/af": 6, "hair/sh": 40, "hair/co": 26, "styling/pw": 7,
    });
    for (const key of Object.keys(SUB_HANDLES)) {
      expect(count(MIN, key), key).toBe(count(CATALOGUE, key));
      expect(SUBCATS[key.split("/")[0]].some((d) => d.id === key.split("/")[1]), key + " is a chip").toBe(true);
    }
  });

  /* 26.10.2026: Renat renamed a Proraso aftershave balm without its type
     word, beard/af listed 5, and the deploy hook's build failed on «fewer than
     6» — every build after it would have. Dim: no limit; an empty
     subcollection keeps its page, noindex, out of the sitemap. */
  it("holds no minimum; an empty subcollection is noindex and left out of the sitemap", () => {
    const pre = readFileSync(ROOT + "tools/prerender-shop2.mjs", "utf8");
    expect(pre).not.toContain("SUBCOLLECTION_MIN");
    expect(pre).not.toContain("throw new Error(key + \" holds \"");
    expect(pre).toContain('if (!list.length && !/noindex/.test(ROBOTS)) page.spec.robots = "noindex, follow";');
    expect(pre).toContain('if (!SUB_EMPTY.has(key)) entries.push(urlEntry("/c/" + key + "/", lang.seg, "0.7"));');
    const check = readFileSync(ROOT + "tools/check-prerender.mjs", "utf8");
    expect(check).toContain("Object.keys(SUB_HANDLES).length - subEmpty.length");
    // the shop says the same: noindex and a way to the section
    expect(APP).toContain('subEmpty() && !/noindex/.test(SERVED_ROBOTS) ? "noindex, follow"');
  });

  it("has no scalp-care and no Korean-cosmetics page — neither is a chip", () => {
    for (const h of ["scalp-treatment", "peanaha-hooldus", "skraby-dlya-golovy", "korean-cosmetics", "shaving", "raseerimine",
      "sredstva-dlya-britya", "beard-and-mustache-wax", "habeme-vuntsivahad", "vosk-dlya-borody-i-usov"]) {
      expect(subOfHandle(h), h).toBeNull();
    }
  });

  it("has the words of every published page and of no other", () => {
    expect(Object.keys(seoCopy().sub).sort()).toEqual(Object.keys(SUB_HANDLES).sort());
    for (const [key, per] of Object.entries(SUB_PAGES)) {
      for (const L of LANGS) {
        const w = per[L];
        expect(w, key + " " + L).toBeTruthy();
        const head = seoHead("sub", key, L, {});
        expect(head.t, key + " " + L).toBe(w.title.replace(/\s*\|\s*REMPIRE$/, " — REMPIRE"));
        expect(head.t.length, `${key} ${L} title «${head.t}»`).toBeLessThanOrEqual(60);
        expect(head.d, key + " " + L).toBe(w.meta);
        expect(w.meta.length, `${key} ${L} description`).toBeLessThanOrEqual(155);
        // no link-preview pair of its own: the title and the description, never the section's
        expect([head.ogT, head.ogD]).toEqual([head.t, head.d]);
        expect(w.name.length).toBeGreaterThan(2);
        // the slot of a section's own line: two or three sentences
        const sentences = w.intro.split(/(?<=[.!?])\s+/).filter(Boolean).length;
        expect(sentences, `${key} ${L} intro`).toBeGreaterThanOrEqual(2);
        expect(sentences, `${key} ${L} intro`).toBeLessThanOrEqual(3);
        expect(w.intro.length, `${key} ${L} intro`).toBeLessThanOrEqual(300);
        // the page's own language, never another one's leftovers
        if (L !== "RU") expect(/[А-Яа-яЁё]/.test(w.name + w.title + w.meta + w.intro), `${key} ${L} has Cyrillic`).toBe(false);
        else expect(/[А-Яа-яЁё]/.test(w.name + w.intro)).toBe(true);
      }
    }
  });

  it("carries the words people search, in each language", () => {
    const has = (key: string, L: Lang, word: RegExp) =>
      expect(word.test(Object.values(SUB_PAGES[key][L]).join(" ")), `${key} ${L} ${word}`).toBe(true);
    has("beard/oi", "ET", /habemeõli/i); has("beard/oi", "RU", /масло для бороды/i); has("beard/oi", "EN", /beard oil/i);
    has("beard/ba", "ET", /habemepalsam/i); has("beard/ba", "RU", /бальзамы для бороды/i); has("beard/ba", "EN", /beard.*balms/i);
    has("beard/af", "ET", /raseerimisjärgne/i); has("beard/af", "RU", /после бритья/i); has("beard/af", "EN", /aftershave/i);
    has("hair/sh", "ET", /šampoonid/i); has("hair/sh", "RU", /шампуни/i); has("hair/sh", "EN", /shampoo/i);
    has("hair/co", "ET", /palsamid/i); has("hair/co", "RU", /кондиционер/i); has("hair/co", "EN", /conditioner/i);
    has("styling/pw", "ET", /juuksevaha/i); has("styling/pw", "RU", /воск для волос/i); has("styling/pw", "EN", /hair wax/i);
  });

  it("heads the page with its own name — the section stays in the crumb (Dim, 09.10.2026)", () => {
    const cat = APP.slice(APP.indexOf("  function screenCatalog() {"), APP.indexOf("  /* Russian counts take three forms"));
    expect(cat).toContain("if (subPg) { ownIntro = subPg.intro; intro = esc(subPg.intro); }");
    expect(cat).toContain("var subH1 = subPg ? subPg.h1 || subPg.name : \"\";");
    // already in the page's language: the dictionary must not touch it
    expect(cat).toContain("'<h1 class=\"display h1\" data-notr>' + esc(subH1) + \"</h1>\"");
    // the crumb still names the section, then the chip
    expect(cat).toMatch(/subPg \? '<a href="' \+ linkHref\("cat", S\.cat\)/);
    // a heading that fits the display face in at most two lines on a phone —
    // and an honest one: the beard-balm page also holds Proraso's aftershave
    // balms, so its heading says both (Dim, 09.10.2026), no shorter h1
    for (const [key, byLang] of Object.entries(SUB_PAGES))
      for (const L of ["RU", "ET", "EN"] as Lang[]) {
        const w = byLang[L] as { name: string; h1?: string };
        expect((w.h1 || w.name).length, `${key} ${L}`).toBeLessThanOrEqual(45);
      }
    for (const L of ["RU", "ET", "EN"] as Lang[]) {
      const w = SUB_PAGES["beard/ba"][L] as { name: string; h1?: string; title: string };
      expect(w.h1, L).toBeUndefined();
      expect(w.name, L).toMatch(/после бритья|raseerimisjärgsed|aftershave/i);
      expect(w.title, L).toMatch(/после бритья|raseerimisjärgsed|aftershave/i);
    }
  });
});

/* ---- addresses ------------------------------------------------------------ */
const ADDRESSES: Record<string, Record<Lang, string>> = {
  "beard/oi": { EN: "/collections/beard-oil", ET: "/et/collections/habemeolid", RU: "/ru/collections/maslo-dlya-borody" },
  "beard/ba": { EN: "/collections/beard-balm", ET: "/et/collections/habemepalsamid", RU: "/ru/collections/balzam-dlya-borody" },
  "beard/af": { EN: "/collections/aftershave", ET: "/et/collections/raseerimisjargne-hooldus", RU: "/ru/collections/losony-posle-britya" },
  "hair/sh": { EN: "/collections/shampoo", ET: "/et/collections/shampoonid", RU: "/ru/collections/shampuni-dlya-volos" },
  "hair/co": { EN: "/collections/conditioner", ET: "/et/collections/palsamid", RU: "/ru/collections/konditsionery-dlya-volos" },
  "styling/pw": { EN: "/collections/hair-wax", ET: "/et/collections/juuksevaha", RU: "/ru/collections/vosk-dlya-volos" },
};
const OLD_URLS = readFileSync(ROOT + "tools/harvest/old-urls.txt", "utf8").trim().split(/\r?\n/)
  .map((u) => u.replace(/^https?:\/\/[^/]+/, ""));
const SECTION: Record<string, Record<Lang, string>> = {
  beard: { EN: "/collections/beard-care", ET: "/et/collections/habemehooldus", RU: "/ru/collections/uhod-za-borodoy" },
  hair: { EN: "/collections/hair-care", ET: "/et/collections/juuksehooldus", RU: "/ru/collections/uhod-za-volosami" },
  styling: { EN: "/collections/hair-styling", ET: "/et/collections/viimistlus", RU: "/ru/collections/stayling-dlya-volos" },
  face: { EN: "/collections/face-care", ET: "/et/collections/naohooldus", RU: "/ru/collections/uhod-za-litsom" },
};

describe("the addresses — Shopify's own handle, per language", () => {
  it("spells every subcollection the way Shopify's sitemap did", () => {
    expect(Object.keys(SUB_HANDLES).sort()).toEqual(Object.keys(ADDRESSES).sort());
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const L of LANGS) {
        expect(publicPath(L, `/c/${key}/`), `${key} ${L}`).toBe(per[L]);
        // and the handle IS in Shopify's sitemap, in that language
        expect(OLD_URLS, per[L]).toContain(per[L]);
      }
    }
  });

  it("reads each address back into the subcollection's route, in its language", () => {
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const L of LANGS) {
        expect(parseShopPath(per[L]), per[L]).toMatchObject({ lang: L, rest: `/c/${key}/`, canonical: per[L] });
      }
    }
    // another language's spelling is still the subcollection — with this language's canonical
    expect(parseShopPath("/et/collections/beard-oil")).toMatchObject({ rest: "/c/beard/oi/", canonical: "/et/collections/habemeolid" });
  });

  it("collides with no section, no brand and no reserved handle", () => {
    const brands = new Set((catalogueMin as Array<{ b: string }>).map((p) => p.b.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")));
    for (const per of Object.values(SUB_HANDLES)) {
      for (const h of Object.values(per)) {
        expect(brands.has(h), h).toBe(false);
        expect(["brands", "sets"]).not.toContain(h);
        expect(parseShopPath("/collections/" + h)!.rest.split("/").length, h).toBe(5);   // "/c/<cat>/<sub>/"
      }
    }
  });

  it("knows only the published ones", () => {
    expect(isSubcollection("beard", "oi")).toBe(true);
    expect(isSubcollection("beard", "af")).toBe(true);
    expect(isSubcollection("beard", "ge")).toBe(false);
    expect(isSubcollection("hair", "ca")).toBe(false);
  });

  it("is a page to the request-time 404 check, a chip with no page is not", () => {
    expect(isKnownShopPath(["c", "beard", "oi"])).toBe(true);
    expect(isKnownShopPath(["c", "styling", "pw"])).toBe(true);
    expect(isKnownShopPath(["c", "beard", "ge"])).toBe(false);
    expect(isKnownShopPath(["c", "face", "kr"])).toBe(false);
    expect(isKnownShopPath(["c", "nope", "oi"])).toBe(false);
  });

  it("app.js carries the same handles (SHOP_SUB_HANDLES) inside its address functions", () => {
    const from = APP.indexOf("  var LANG_OF_SEG = ");
    const to = APP.indexOf("  /** The panel and its scanner live at one address");
    const box: Record<string, unknown> = {};
    runInNewContext(APP.slice(from, to) +
      "\nthis.H = SHOP_SUB_HANDLES; this.shopPathFor = shopPathFor; this.shopRouteOf = shopRouteOf;", box);
    expect(JSON.parse(JSON.stringify(box.H))).toEqual(JSON.parse(JSON.stringify(SUB_HANDLES)));
    const shopPathFor = box.shopPathFor as (l: string, r: string) => string;
    const shopRouteOf = box.shopRouteOf as (p: string) => { rest: string } | null;
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const L of LANGS) {
        expect(shopPathFor(L, `/c/${key}/`)).toBe(per[L]);
        expect(shopRouteOf(per[L])!.rest).toBe(`/c/${key}/`);
      }
    }
  });
});

/* ---- one hop -------------------------------------------------------------- */
function landing(address: string): string {
  const [p, q] = address.split("?");
  const hit = legacyTarget(p, q ? "?" + q : "");
  const to = hit ? hit.path : address;
  // never a chain: where it lands is served as it is
  const [tp, tq] = to.split("?");
  expect(legacyTarget(tp, tq ? "?" + tq : ""), `${address} → ${to} moves again`).toBeNull();
  return to;
}

describe("the old Shopify handles — the page itself, or ONE 301", () => {
  it("answers every subcollection row of Shopify's sitemap with the page, no redirect", () => {
    const own = OLD_URLS.filter((u) => /\/collections\/[^/]+$/.test(u) && subOfHandle(u.split("/").pop()!));
    for (const u of own) {
      const to = landing(u);
      const key = subOfHandle(u.split("/").pop()!)!;
      expect(parseShopPath(to)!.rest, u).toBe(`/c/${key}/`);
      if (/^\/(?:ru|et)\//.test(u) || /^\/collections\//.test(u)) expect(to, u).toBe(u);
    }
    expect(own.length).toBe(6 * 6);   // six handles × unprefixed, /ru, /et and the three regional English storefronts
  });

  it("moves another language's spelling, a trailing slash, a capital prefix and a regional storefront in one hop", () => {
    const cases: Array<[string, string]> = [
      ["/collections/habemeolid", "/collections/beard-oil"],
      ["/et/collections/beard-oil", "/et/collections/habemeolid"],
      ["/ru/collections/beard-oil", "/ru/collections/maslo-dlya-borody"],
      ["/ru/collections/palsamid", "/ru/collections/konditsionery-dlya-volos"],
      ["/collections/shampuni-dlya-volos", "/collections/shampoo"],
      ["/et/collections/aftershave", "/et/collections/raseerimisjargne-hooldus"],
      ["/collections/beard-oil/", "/collections/beard-oil"],
      ["/ET/collections/juuksevaha", "/et/collections/juuksevaha"],
      ["/en-lv/collections/beard-oil", "/collections/beard-oil"],
      ["/en-fi/collections/aftershave", "/collections/aftershave"],
      ["/en/collections/hair-wax", "/collections/hair-wax"],
    ];
    for (const [from, to] of cases) expect(landing(from), from).toBe(to);
  });

  it("reads a tag filter, Shopify's other product URL, an Atom feed and a discount link through the subcollection", () => {
    expect(landing("/collections/beard-oil/proraso")).toBe("/collections/beard-oil");
    expect(landing("/et/collections/juuksevaha/gatsby")).toBe("/et/collections/juuksevaha");
    expect(legacyTarget("/collections/aftershave/proraso")!.reason).toBe("collection-sub");
    expect(landing("/collections/shampoo/products/repair-me-wash")).toBe("/products/repair-me-wash");
    expect(landing("/collections/beard-oil.atom")).toBe("/collections/beard-oil");
    expect(landing("/et/collections/habemeolid.atom")).toBe("/et/collections/habemeolid");
    expect(landing("/discount/WELCOME10?redirect=/collections/shampoo")).toBe("/collections/shampoo");
  });

  it("sends every handle without a page to its section, as before 09.10.2026", () => {
    const cases: Array<[string, string]> = [
      ["/collections/shaving", SECTION.beard.EN],
      ["/et/collections/raseerimine", SECTION.beard.ET],
      ["/ru/collections/sredstva-dlya-britya", SECTION.beard.RU],
      ["/collections/beard-and-mustache-wax", SECTION.beard.EN],
      ["/et/collections/habeme-vuntsivahad", SECTION.beard.ET],
      ["/ru/collections/vosk-dlya-borody-i-usov", SECTION.beard.RU],
      ["/collections/scalp-treatment", SECTION.hair.EN],
      ["/et/collections/peanaha-hooldus", SECTION.hair.ET],
      ["/ru/collections/skraby-dlya-golovy", SECTION.hair.RU],
      ["/collections/korean-cosmetics", SECTION.face.EN],
      ["/et/collections/korean-cosmetics", SECTION.face.ET],
      ["/ru/collections/korean-cosmetics", SECTION.face.RU],
      ["/collections/hair-mask", SECTION.hair.EN],
      ["/et/collections/juuksemaskid", SECTION.hair.ET],
      ["/ru/collections/laki-dlya-volos", SECTION.styling.RU],
      ["/collections/beard-styling", SECTION.beard.EN],
      ["/collections/face-sheet-masks", SECTION.face.EN],
    ];
    for (const [from, to] of cases) {
      expect(landing(from), from).toBe(to);
      expect(legacyTarget(from)!.reason, from).toBe("collection-cat");
    }
  });
});

/* ---- the head and the sitemap -------------------------------------------- */
const BASE_URL = "https://rempireshop.com";

describe("hreflang — one cluster per subcollection, Shopify's handle in each language", () => {
  it("names the page itself as canonical and its two twins plus x-default", () => {
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const [seg, L] of [["", "EN"], ["ru", "RU"], ["et", "ET"]] as const) {
        const html = headLinks(BASE_URL, seg, `/c/${key}/`);
        expect(html).toContain(`<link rel="canonical" href="${BASE_URL}${per[L]}"`);
        expect(html).toContain(`hreflang="ru" href="${BASE_URL}${per.RU}"`);
        expect(html).toContain(`hreflang="et" href="${BASE_URL}${per.ET}"`);
        expect(html).toContain(`hreflang="en" href="${BASE_URL}${per.EN}"`);
        expect(html).toContain(`hreflang="x-default" href="${BASE_URL}${per.EN}"`);
        expect(langBySeg(seg)!.code).toBe(L);
      }
    }
  });
});

describe("the sitemap", () => {
  it("writes one <url> per subcollection and language, each with the whole cluster", () => {
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const [seg, L] of [["", "EN"], ["ru", "RU"], ["et", "ET"]] as const) {
        const row = sitemapUrlEntry(BASE_URL, `/c/${key}/`, seg, "0.7", "2026-10-09");
        expect(row).toContain(`<loc>${BASE_URL}${per[L]}</loc>`);
        expect((row.match(/<xhtml:link /g) || []).length).toBe(4);
        for (const l of LANGS) expect(row).toContain(`href="${BASE_URL}${per[l]}"`);
      }
    }
  });

  it("is told to list every published subcollection with something in it — the prerender's loop and the checker's count", () => {
    const pre = readFileSync(ROOT + "tools/prerender-shop2.mjs", "utf8");
    expect(pre).toContain('for (const key of Object.keys(SUB_HANDLES)) if (!SUB_EMPTY.has(key)) entries.push(urlEntry("/c/" + key + "/", lang.seg, "0.7"));');
    expect(pre).toContain("for (const key of Object.keys(SUB_HANDLES)) pages.push(subcollectionPage(key, lang));");
    const check = readFileSync(ROOT + "tools/check-prerender.mjs", "utf8");
    expect(check).toContain("Object.keys(SUB_HANDLES).length - subEmpty.length + BRANDS.length");
  });
});
