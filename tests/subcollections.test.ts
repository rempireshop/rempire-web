/**
 * Subcollections — a section's chip with a page of its own, at the handle
 * Shopify had for it (SEO audit 08.10.2026, §6.2, §7.1 and T6; Dim, 09.10.2026).
 *
 * Who is in which subtype is ONE function, subcatsAuto() in
 * public/shop2/app.js, beside the chips that use it; tools/prerender-shop2.mjs
 * lifts it out of that file by its first and last lines (with SUBCATS,
 * SUB_PICKS and SUB_PAGES), and so does this test, the same way — so what is
 * held here is what the chips filter and what the static pages list.
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
import { headLinks, langBySeg, sitemapUrlEntry } from "@/lib/seo-head.mjs";
import {
  isSubcollection,
  parseShopPath,
  publicPath,
  SUB_HANDLES,
  SUBCOLLECTION_MIN,
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
type Def = { id: string; name: string };
type Words = { h1: string; title: string; desc: string; intro: string };
type Product = { id: string; name: string; cat: string; brand: string };
const PIECES = [
  sliceFrom(/^ {2}var SUBCATS = \{$/, DECL_END),
  sliceFrom(/^ {2}var SUB_PICKS = \{$/, DECL_END),
  sliceFrom(/^ {2}var SUB_PAGES = \{$/, DECL_END),
  sliceFrom(/^ {2}function subcatsAuto\(p\) \{$/, FN_END),
  sliceFrom(/^ {2}function subcatsWith\(p, own\) \{$/, FN_END),
];
const ctx: Record<string, unknown> = {};
runInNewContext(
  PIECES.join("\n") +
    "\nthis.SUBCATS = SUBCATS; this.SUB_PAGES = SUB_PAGES; this.auto = subcatsAuto; this.withOwn = subcatsWith;",
  ctx,
);
const SUBCATS = ctx.SUBCATS as Record<string, Def[]>;
const SUB_PAGES = ctx.SUB_PAGES as Record<string, Record<Lang, Words>>;
const auto = ctx.auto as (p: Product) => string[];
const withOwn = ctx.withOwn as (p: Product, own: string) => string[];

/* The catalogue the prerender reads (public/shop/catalogue2.js) and the one
   the edge reads (src/data/catalogue.min.json) — the same 220 products. */
const CATALOGUE = new Function(readFileSync(ROOT + "public/shop/catalogue2.js", "utf8") + "\nreturn CATALOGUE;")() as Product[];
const MIN = (catalogueMin as Array<{ id: string; n: string; c: string; b: string }>).map((p) => ({ id: p.id, name: p.n, cat: p.c, brand: p.b }));

/* ---- who is where --------------------------------------------------------- */
/* Every product of the four sections that have chips, by subtype — the table
   to review: a product is in exactly the subtypes that list it. */
const EXPECTED: Record<string, string[]> = {
  "hair/sh": [
    "system-4-bio-botanical-shampoo", "repair-me-wash", "killer-curls-wash", "system-4-mild-shampoo-3",
    "kevin-murphy-blow-dry-wash", "maxi-wash", "system-4-balancing-shampoo-2", "system-4-special-shampoo-1",
    "cbd-daily-shampoo", "davines-renewing-shampoo", "davines-wellbeing-shampoo", "davines-detoxifying-scrub-shampoo",
    "davines-calming-shampoo", "davines-nourishing-shampoo", "davines-purifying-shampoo", "davines-energizing-shampoo",
    "davines-replumping-shampoo", "davines-rebalancing-shampoo", "kevin-murphy-smooth-again-wash", "kevin-murphy-fresh-hair-1",
    "kevin-murphy-everlasting-colour-wash", "kevin-murphy-young-again-wash", "kevin-muprhy-plumping-wash",
    "kevin-muprhy-hydrate-me-wash", "kevin-murphy-angel-wash", "kevin-muprhy-blonde-angel-wash", "stimulate-me-wash",
    "paul-mitchell-clear-essential-shampoo", "paul-mitchell-extra-body-daily-shampoo", "paul-mitchell-forever-blonde-shampoo",
    "paul-mitchell-mitch-double-hitter-2-in-1-shampoo-conditioner", "paul-mitchell-awapuhi-shampoo-1",
    "paul-mitchell-super-smooth-shampoo", "paul-mitchell-sheer-hydration-shampoo", "paul-mitchell-color-protect-shampoo",
    "paul-mitchell-awapuhi-shampoo", "paul-mitchell-tea-tree-lavender-mint-shampoo", "paul-mitchell-shampoo-two",
    "paul-mitchell-tea-tree-special-shampoo", "system-4-shale-oil-shampoo-4",
  ],
  "hair/co": [
    "killer-curls-rinse", "system-4-hydro-care-conditioner-h", "system-4-bio-botanical-vital-cure", "cbd-daily-conditioner",
    "young-again-dry-conditioner", "kevin-murphy-blow-dry-rinse", "kevin-murphy-crystal-angel",
    "kevin-murphy-everlasting-colour-rinse", "kevin-murphy-smooth-again-rinse", "kevin-murphy-young-again-rinse",
    "kevin-muprhy-plumping-rinse", "kevin-murphy-hydrate-me-rinse", "kevin-murphy-angel-rinse", "kevin-murphy-blonde-angel",
    "repair-me-rinse", "stimulate-me-rinse", "lumin-skin-keratin-fortifying-conditioner",
    "paul-mitchell-clear-essential-conditioner", "paul-mitchell-forever-blonde-conditioner",
    "paul-mitchell-mitch-double-hitter-2-in-1-shampoo-conditioner", "paul-mitchell-awapuhi-wild-ginger-repair-cream-rinse",
    "paul-mitchell-super-smooth-conditioner", "paul-mitchell-tea-tree-special-conditioner-1",
    "paul-mitchell-sheer-hydration-conditioner", "paul-mitchell-color-protect-conditioner", "paul-mitchell-awapuhi-conditioner",
    "paul-mitchell-tea-tree-special-conditioner",
  ],
  "hair/ca": [
    "system-4-bio-botanical-serum", "sim-sensitive-system-4-oil-cure-scalp-treatment-o", "sim-sensitive-system-4-scalp-tonic-t",
    "kevin-murphy-motion-lotion", "davines-naturaltech-nourishing-keratin-booster-100ml", "davines-the-quick-fix-circle",
    "davines-the-spotlight-circle", "davines-the-restless-circle", "davines-the-renaissance-circle",
    "kevin-murphy-night-shift-100ml", "kevin-murphy-re-store", "kevin-murphy-angel-masque", "kevin-murphy-hydrate-me-masque",
    "kevin-murphy-smooth-again", "kevin-murphy-young-again-oil", "kevin-murphy-young-again-masque", "heated-defense",
    "leave-in-repair", "paul-mitchell-curl-quick-slip-styling-cream", "paul-mitchell-clear-jelly-mask",
    "paul-mitchell-clear-smoothing-serum", "paul-mitchell-curl-hydrating-foam", "paul-mitchell-curl-twirl-around-cream-serum",
    "paul-mitchell-curl-full-circle-leave-in-cream", "paul-mitchell-curl-round-trip-defining-serum",
    "system-4-moisture-scalp-lotion-m",
  ],
  "hair/sp": [
    "touchable", "kevin-murphy-un-tangled-spray", "sim-sensitive-system-4-chitosan-hair-repair-r", "hair-resort-spray",
    "davines-naturaltech-nourishing-keratin-sealer-100-ml", "kevin-murphy-body-mass", "kevin-murphy-everlasting-colour-leave-in",
    "kevin-murphy-staying-alive-spray", "blow-dry-ever-smooth", "thick-again", "paul-mitchell-curl-refreshing-mist",
  ],
  "hair/sc": [
    "system-4-bio-botanical-shampoo", "system-4-bio-botanical-serum", "sim-sensitive-system-4-oil-cure-scalp-treatment-o",
    "system-4-mild-shampoo-3", "sim-sensitive-system-4-scalp-tonic-t", "system-4-hydro-care-conditioner-h",
    "system-4-bio-botanical-vital-cure", "system-4-balancing-shampoo-2", "system-4-special-shampoo-1",
    "davines-detoxifying-scrub-shampoo", "davines-calming-shampoo", "davines-purifying-shampoo", "davines-energizing-shampoo",
    "davines-rebalancing-shampoo", "system-4-moisture-scalp-lotion-m", "system-4-shale-oil-shampoo-4",
  ],
  "styling/pw": [
    "gatsby-moving-rubber-grunge-mat-grey-hair-wax", "gatsby-moving-rubber-wild-shake-15g", "mandom-gatsby-moving-rubber",
    "paul-mitchell-mitch-construction-paste-flexible-styling-paste", "davines-pasta-love-strong-hold-mat-clay",
    "davines-medium-hold-styling-paste", "gatsby-moving-rubber-hair-wax-80g",
  ],
  "styling/sp": [
    "captain-fawcett-sea-salt-spray", "kevin-murphy-session-spray", "kevin-murphy-session-spray-flex",
    "kevin-muprhy-shimmer-shine", "kevin-murphy-shimmer-me-blonde", "anti-gravity-spray", "doo-over", "bedroom-hair",
    "killer-waves", "paul-mitchell-awapuhi-texturizing-sea-spray",
  ],
  "styling/ge": ["super-goo", "paul-mitchell-clear-styling-glaze", "paul-mitchell-mitch-steady-grip-styling-gel"],
  "styling/pu": ["powder-puff", "captain-fawcett-expedition-reserve-matt-styling-and-volumising-hair-powder"],
  "beard/oi": [
    "captain-fawcett-beard-oil-cf-332-private-stock", "proraso-beard-oil-azur-lime-30ml", "proraso-beard-oil-green-refreshing-30ml",
    "proraso-beard-oil-cypress-vetyver-30ml", "proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml",
    "davines-pre-shaving-beard-oil", "captain-fawcett-maharajah-beard-oil", "captain-fawcett-nebula-john-petrucci-beard-oil",
    "captain-fawcett-barberism-beard-oil", "captain-fawcett-ricki-hall-booze-baccy-beard-oil",
    "captain-fawcett-triumphant-beard-oil", "captain-fawcett-whisky-beard-oil",
  ],
  "beard/ba": [
    "proraso-wood-spice-beard-balm-100ml", "captain-fawcett-nebula-john-petrucci-beard-balm",
    "captain-fawcett-sid-sottung-barberism-beard-balm", "captain-fawcett-ricki-hall-booze-baccy-beard-balm",
    "captain-fawcett-nebula-moustache-wax", "captain-fawcett-ricki-hall-booze-baccy-moustache-wax",
    "captain-fawcett-barberism-moustache-wax",
  ],
  "beard/af": [
    "proraso-azur-lime-after-shave-balm-100-ml", "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml",
    "proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml",
    "proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml", "proraso-red-nourishing-aftershave-lotion-100ml",
    "proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml", "davines-pre-shaving-beard-oil",
    "davines-softening-shaving-gel", "davines-non-foaming-transparent-shaving-gel",
  ],
  "beard/ge": ["davines-softening-shaving-gel", "davines-non-foaming-transparent-shaving-gel"],
  "face/to": [
    "cosrx-full-fit-propolis-synergy-toner", "cosrx-aha-bha-clarifying-treatment-toner", "anua-bha-2-gentle-exfoliating-toner-150ml",
    "anua-heartleaf-77-soothing-toner",
  ],
  "face/cl": [
    "anua-heartleaf-pore-control-cleansing-oil", "cosrx-low-ph-good-morning-gel-cleanser",
    "anua-heartleaf-quercetinol-pore-deep-cleansing-foam", "lumin-skin-charcoal-scrub-deep-detox",
    "lumin-skin-charcoal-face-wash-daily-detox",
  ],
  "face/cs": [
    "anua-niacinamide-10-txa-4-serum", "cosrx-advanced-snail-92-all-in-one-cream", "cosrx-advanced-snail-96-mucin-power-essence",
    "lumin-skin-wrinkle-defense-serum", "lumin-skin-dark-circle-defense-balm", "cosrx-aloe-sun-cream",
  ],
  "face/oi": ["lumin-skin-recovery-oil"],
  "face/kr": [
    "cosrx-full-fit-propolis-synergy-toner", "anua-heartleaf-pore-control-cleansing-oil", "cosrx-aha-bha-clarifying-treatment-toner",
    "cosrx-low-ph-good-morning-gel-cleanser", "anua-bha-2-gentle-exfoliating-toner-150ml", "anua-niacinamide-10-txa-4-serum",
    "anua-heartleaf-quercetinol-pore-deep-cleansing-foam", "cosrx-advanced-snail-92-all-in-one-cream",
    "cosrx-advanced-snail-96-mucin-power-essence", "gummy-sheet-mask-madecassoside-sticker", "anua-heartleaf-77-soothing-toner",
    "cosrx-advanced-snail-hydrogel-eye-patch-60pcs", "cosrx-aloe-sun-cream", "laneige-cica-sleeping-mask",
    "real-nature-green-tea-mask-sheet",
  ],
};
/* In a section with chips and in none of them, on purpose: styling products
   the catalogue files under «Уход за волосами» (a paste, a paste, a clay —
   the owner can move them), and the creams, lotions, mousse and serum of
   «Стайлинг», which none of its four chips is. */
const IN_NONE = [
  "night-rider", "free-hold", "rough-rider",
  "kevin-murphy-killer-twirls", "easy-rider", "killer-curls", "body-builder", "paul-mitchell-super-skinny-serum",
  "kevin-murphy-full-again", "hair-resort", "anti-gravity",
];

describe("the lift — what tools/prerender-shop2.mjs takes out of app.js", () => {
  it("finds every slice, each closing on a line of its own", () => {
    expect(PIECES.every(Boolean)).toBe(true);
    expect(Object.keys(SUBCATS).sort()).toEqual(["beard", "face", "hair", "styling"]);
  });
});

describe("subcatsAuto — every product in exactly the subtypes it should be", () => {
  const want = new Map<string, string[]>();
  for (const [key, ids] of Object.entries(EXPECTED)) {
    const sub = key.split("/")[1];
    for (const id of ids) want.set(id, [...(want.get(id) || []), sub]);
  }

  it("covers the whole catalogue: listed, or listed as in none", () => {
    const chipped = CATALOGUE.filter((p) => SUBCATS[p.cat]);
    expect(chipped.length).toBe(183);
    for (const p of chipped) expect(want.has(p.id) || IN_NONE.includes(p.id), p.id).toBe(true);
  });

  it.each(CATALOGUE.filter((p) => SUBCATS[p.cat]).map((p) => [p.id, p] as const))("%s", (_id, p) => {
    const order = SUBCATS[p.cat].map((d) => d.id);
    const expected = (want.get(p.id) || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    expect(auto(p)).toEqual(expected);
  });

  it("puts nothing outside the four sections in a subtype", () => {
    for (const p of CATALOGUE.filter((x) => !SUBCATS[x.cat])) expect(auto(p), p.id).toEqual([]);
  });

  it("reads the edge's catalogue (catalogue.min.json) the same way", () => {
    for (const p of MIN) {
      const full = CATALOGUE.find((x) => x.id === p.id)!;
      expect(auto(p), p.id).toEqual(auto(full));
    }
  });

  it("matches what the old name-only regexes missed, and keeps an aftershave balm out of the beard balms", () => {
    const none = (cat: string) => CATALOGUE.filter((p) => p.cat === cat && !auto(p).length).length;
    expect(none("hair")).toBe(3);      // 17 of 106 before (audit §6.2)
    expect(none("styling")).toBe(8);   // 14 of 30
    expect(none("face")).toBe(0);      // 8 of 20
    expect(auto({ id: "x", name: "Azur Lime — бальзам после бритья", cat: "beard", brand: "Proraso" })).toEqual(["af"]);
    expect(auto({ id: "x", name: "Wood & Spice — бальзам для бороды", cat: "beard", brand: "Proraso" })).toEqual(["ba"]);
  });

  it("sorts a product the owner makes himself by its Russian name, like the catalogue's", () => {
    expect(auto({ id: "c-abc", name: "Мятный шампунь", cat: "hair", brand: "Своя марка" })).toEqual(["sh"]);
    expect(auto({ id: "c-abd", name: "Масло для бороды «Кедр»", cat: "beard", brand: "Своя марка" })).toEqual(["oi"]);
    expect(auto({ id: "c-abe", name: "Тонер", cat: "face", brand: "Anua" })).toEqual(["kr"]);
  });
});

describe("the owner's own «Подраздел» wins", () => {
  const p = CATALOGUE.find((x) => x.id === "system-4-special-shampoo-1")!;
  it("replaces the rules with the one subtype he chose", () => {
    expect(withOwn(p, "")).toEqual(["sh", "sc"]);
    expect(withOwn(p, "ca")).toEqual(["ca"]);
  });
  it("is ignored when it names a subtype the section does not have", () => {
    expect(withOwn(p, "kr")).toEqual(["sh", "sc"]);
    expect(withOwn(p, "nonsense")).toEqual(["sh", "sc"]);
  });
});

describe("publishing — at least SUBCOLLECTION_MIN products and words in three languages", () => {
  const count = (list: Product[], key: string) => {
    const [cat, sub] = key.split("/");
    return list.filter((p) => p.cat === cat && auto(p).includes(sub)).length;
  };

  it("publishes the eight candidates, every one over the threshold, in both catalogue files", () => {
    expect(SUBCOLLECTION_MIN).toBe(6);
    expect(Object.keys(SUB_HANDLES).sort()).toEqual(
      ["beard/af", "beard/ba", "beard/oi", "face/kr", "hair/co", "hair/sc", "hair/sh", "styling/pw"],
    );
    for (const key of Object.keys(SUB_HANDLES)) {
      expect(count(CATALOGUE, key), key).toBeGreaterThanOrEqual(SUBCOLLECTION_MIN);
      expect(count(MIN, key), key).toBe(count(CATALOGUE, key));
      expect(SUBCATS[key.split("/")[0]].some((d) => d.id === key.split("/")[1]), key + " is a chip").toBe(true);
    }
    expect(Object.fromEntries(Object.keys(SUB_HANDLES).map((k) => [k, count(CATALOGUE, k)]))).toEqual({
      "beard/oi": 12, "beard/ba": 7, "beard/af": 9, "hair/sh": 40, "hair/co": 27, "hair/sc": 16, "styling/pw": 7, "face/kr": 15,
    });
  });

  it("gives moustache wax no page of its own (3 of the 4 it would need) — it is on the beard-balm page", () => {
    const wax = CATALOGUE.filter((p) => p.cat === "beard" && /moustache wax|воск/i.test(p.name));
    expect(wax.length).toBe(3);
    for (const p of wax) expect(auto(p)).toEqual(["ba"]);
    for (const h of ["beard-and-mustache-wax", "habeme-vuntsivahad", "vosk-dlya-borody-i-usov"]) expect(subOfHandle(h)).toBeNull();
  });

  it("has the words of every published page and of no other", () => {
    expect(Object.keys(SUB_PAGES).sort()).toEqual(Object.keys(SUB_HANDLES).sort());
    for (const [key, per] of Object.entries(SUB_PAGES)) {
      for (const L of LANGS) {
        const w = per[L];
        expect(w, key + " " + L).toBeTruthy();
        expect(w.title.length, `${key} ${L} title «${w.title}»`).toBeLessThanOrEqual(60);
        expect(w.desc.length, `${key} ${L} description`).toBeLessThanOrEqual(155);
        expect(w.h1.length).toBeGreaterThan(2);
        // the slot of a section's own line: two or three sentences
        const sentences = w.intro.split(/(?<=[.!?])\s+/).filter(Boolean).length;
        expect(sentences, `${key} ${L} intro`).toBeGreaterThanOrEqual(2);
        expect(sentences, `${key} ${L} intro`).toBeLessThanOrEqual(3);
        expect(w.intro.length, `${key} ${L} intro`).toBeLessThanOrEqual(300);
        // the page's own language, never another one's leftovers
        if (L !== "RU") expect(/[А-Яа-яЁё]/.test(w.h1 + w.title + w.desc + w.intro), `${key} ${L} has Cyrillic`).toBe(false);
        else expect(/[А-Яа-яЁё]/.test(w.h1 + w.intro)).toBe(true);
      }
    }
  });

  it("carries the words people search, in each language", () => {
    const has = (key: string, L: Lang, word: RegExp) =>
      expect(word.test(Object.values(SUB_PAGES[key][L]).join(" ")), `${key} ${L} ${word}`).toBe(true);
    has("beard/oi", "ET", /habemeõli/i); has("beard/oi", "RU", /масло для бороды/i); has("beard/oi", "EN", /beard oil/i);
    has("beard/ba", "ET", /habemepalsam/i); has("beard/ba", "RU", /воск для усов/i); has("beard/ba", "EN", /moustache wax/i);
    has("beard/af", "ET", /raseerimine/i); has("beard/af", "RU", /для бритья/i); has("beard/af", "EN", /aftershave/i);
    has("hair/sh", "ET", /šampoonid/i); has("hair/sh", "RU", /шампуни/i); has("hair/sh", "EN", /shampoo/i);
    has("hair/co", "ET", /palsamid/i); has("hair/co", "RU", /кондиционер/i); has("hair/co", "EN", /conditioner/i);
    has("hair/sc", "ET", /peanahahooldus/i); has("hair/sc", "RU", /кож[аи] головы/i); has("hair/sc", "EN", /scalp/i);
    has("styling/pw", "ET", /juuksevaha/i); has("styling/pw", "RU", /воск для волос/i); has("styling/pw", "EN", /hair wax/i);
    has("face/kr", "ET", /korea kosmeetika/i); has("face/kr", "RU", /корейская косметика/i); has("face/kr", "EN", /korean cosmetics/i);
  });
});

/* ---- addresses ------------------------------------------------------------ */
const ADDRESSES: Record<string, Record<Lang, string>> = {
  "beard/oi": { EN: "/collections/beard-oil", ET: "/et/collections/habemeolid", RU: "/ru/collections/maslo-dlya-borody" },
  "beard/ba": { EN: "/collections/beard-balm", ET: "/et/collections/habemepalsamid", RU: "/ru/collections/balzam-dlya-borody" },
  "beard/af": { EN: "/collections/shaving", ET: "/et/collections/raseerimine", RU: "/ru/collections/sredstva-dlya-britya" },
  "hair/sh": { EN: "/collections/shampoo", ET: "/et/collections/shampoonid", RU: "/ru/collections/shampuni-dlya-volos" },
  "hair/co": { EN: "/collections/conditioner", ET: "/et/collections/palsamid", RU: "/ru/collections/konditsionery-dlya-volos" },
  "hair/sc": { EN: "/collections/scalp-treatment", ET: "/et/collections/peanaha-hooldus", RU: "/ru/collections/skraby-dlya-golovy" },
  "styling/pw": { EN: "/collections/hair-wax", ET: "/et/collections/juuksevaha", RU: "/ru/collections/vosk-dlya-volos" },
  "face/kr": { EN: "/collections/korean-cosmetics", ET: "/et/collections/korean-cosmetics", RU: "/ru/collections/korean-cosmetics" },
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
    expect(isSubcollection("beard", "ge")).toBe(false);
    expect(isSubcollection("hair", "ca")).toBe(false);
  });

  it("is a page to the request-time 404 check, the unpublished chip is not", () => {
    expect(isKnownShopPath(["c", "beard", "oi"])).toBe(true);
    expect(isKnownShopPath(["c", "face", "kr"])).toBe(true);
    expect(isKnownShopPath(["c", "beard", "ge"])).toBe(false);
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

describe("the old Shopify handles — the page itself, or ONE 301 to it", () => {
  it("answers every subcollection row of Shopify's sitemap with the page, no redirect", () => {
    const own = OLD_URLS.filter((u) => /\/collections\/[^/]+$/.test(u) && subOfHandle(u.split("/").pop()!));
    // 8 handles × the unprefixed, /ru, /et and three regional English storefronts, minus the
    // regional ones that are not the page (they fold onto the unprefixed address)
    for (const u of own) {
      const to = landing(u);
      const key = subOfHandle(u.split("/").pop()!)!;
      expect(parseShopPath(to)!.rest, u).toBe(`/c/${key}/`);
      if (/^\/(?:ru|et)\//.test(u) || /^\/collections\//.test(u)) expect(to, u).toBe(u);
    }
    expect(own.length).toBeGreaterThanOrEqual(8 * 3);
  });

  it("moves another language's spelling, a trailing slash, a capital prefix and a regional storefront in one hop", () => {
    const cases: Array<[string, string]> = [
      ["/collections/habemeolid", "/collections/beard-oil"],
      ["/et/collections/beard-oil", "/et/collections/habemeolid"],
      ["/ru/collections/beard-oil", "/ru/collections/maslo-dlya-borody"],
      ["/ru/collections/palsamid", "/ru/collections/konditsionery-dlya-volos"],
      ["/collections/shampuni-dlya-volos", "/collections/shampoo"],
      ["/collections/beard-oil/", "/collections/beard-oil"],
      ["/ET/collections/juuksevaha", "/et/collections/juuksevaha"],
      ["/en-lv/collections/beard-oil", "/collections/beard-oil"],
      ["/en-fi/collections/korean-cosmetics", "/collections/korean-cosmetics"],
      ["/en/collections/scalp-treatment", "/collections/scalp-treatment"],
    ];
    for (const [from, to] of cases) expect(landing(from), from).toBe(to);
  });

  it("sends the collections a subcollection now holds to it, in their language", () => {
    const cases: Array<[string, string]> = [
      ["/collections/aftershave", "/collections/shaving"],
      ["/et/collections/raseerimisjargne-hooldus", "/et/collections/raseerimine"],
      ["/ru/collections/losony-posle-britya", "/ru/collections/sredstva-dlya-britya"],
      ["/collections/beard-and-mustache-wax", "/collections/beard-balm"],
      ["/et/collections/habeme-vuntsivahad", "/et/collections/habemepalsamid"],
      ["/ru/collections/vosk-dlya-borody-i-usov", "/ru/collections/balzam-dlya-borody"],
    ];
    for (const [from, to] of cases) {
      expect(landing(from), from).toBe(to);
      expect(legacyTarget(from)!.reason).toBe("collection-sub");
    }
  });

  it("reads a tag filter, Shopify's other product URL, an Atom feed and a discount link through the subcollection", () => {
    expect(landing("/collections/beard-oil/proraso")).toBe("/collections/beard-oil");
    expect(landing("/et/collections/juuksevaha/gatsby")).toBe("/et/collections/juuksevaha");
    expect(landing("/collections/shampoo/products/repair-me-wash")).toBe("/products/repair-me-wash");
    expect(landing("/collections/beard-oil.atom")).toBe("/collections/beard-oil");
    expect(landing("/et/collections/habemeolid.atom")).toBe("/et/collections/habemeolid");
    expect(landing("/discount/WELCOME10?redirect=/collections/shampoo")).toBe("/collections/shampoo");
  });

  it("keeps sending a subtype with no page of its own to its section", () => {
    const cases: Array<[string, string]> = [
      ["/collections/hair-mask", SECTION.hair.EN],
      ["/et/collections/juuksemaskid", SECTION.hair.ET],
      ["/ru/collections/laki-dlya-volos", SECTION.styling.RU],
      ["/collections/hair-lotion", SECTION.hair.EN],
      ["/collections/beard-styling", SECTION.beard.EN],
      ["/ru/collections/sredstva-dlya-britya-1", SECTION.beard.RU],
      ["/collections/face-sheet-masks", SECTION.face.EN],
      ["/et/collections/silmahooldus", SECTION.face.ET],
    ];
    for (const [from, to] of cases) expect(landing(from), from).toBe(to);
  });
});

/* ---- the head and the sitemap -------------------------------------------- */
const BASE = "https://rempireshop.com";

describe("hreflang — one cluster per subcollection, Shopify's handle in each language", () => {
  it("names the page itself as canonical and its two twins plus x-default", () => {
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const [seg, L] of [["", "EN"], ["ru", "RU"], ["et", "ET"]] as const) {
        const html = headLinks(BASE, seg, `/c/${key}/`);
        expect(html).toContain(`<link rel="canonical" href="${BASE}${per[L]}"`);
        expect(html).toContain(`hreflang="ru" href="${BASE}${per.RU}"`);
        expect(html).toContain(`hreflang="et" href="${BASE}${per.ET}"`);
        expect(html).toContain(`hreflang="en" href="${BASE}${per.EN}"`);
        expect(html).toContain(`hreflang="x-default" href="${BASE}${per.EN}"`);
        expect(langBySeg(seg)!.code).toBe(L);
      }
    }
  });
});

describe("the sitemap", () => {
  it("writes one <url> per subcollection and language, each with the whole cluster", () => {
    for (const [key, per] of Object.entries(ADDRESSES)) {
      for (const [seg, L] of [["", "EN"], ["ru", "RU"], ["et", "ET"]] as const) {
        const row = sitemapUrlEntry(BASE, `/c/${key}/`, seg, "0.7", "2026-10-09");
        expect(row).toContain(`<loc>${BASE}${per[L]}</loc>`);
        expect((row.match(/<xhtml:link /g) || []).length).toBe(4);
        for (const l of LANGS) expect(row).toContain(`href="${BASE}${per[l]}"`);
      }
    }
  });

  it("is told to list every published subcollection — the prerender's loop and the checker's count", () => {
    const pre = readFileSync(ROOT + "tools/prerender-shop2.mjs", "utf8");
    expect(pre).toContain('for (const key of Object.keys(SUB_HANDLES)) entries.push(urlEntry("/c/" + key + "/", lang.seg, "0.7"));');
    expect(pre).toContain("for (const key of Object.keys(SUB_HANDLES)) pages.push(subcollectionPage(key, lang));");
    const check = readFileSync(ROOT + "tools/check-prerender.mjs", "utf8");
    expect(check).toContain("Object.keys(SUB_HANDLES).length + BRANDS.length");
  });
});
