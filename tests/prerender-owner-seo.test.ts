/**
 * The owner's «Для Google» title and description on the static product pages
 * (tools/prerender-shop2.mjs), and a set's part photo when the part is off
 * sale (public/shop2/app.js) — both found by the deployed smoke test on
 * 29.10.2026.
 *
 * 1. The live page has drawn Renat's per-language Google pair since 09.2026
 *    (setHead() in app.js); the static page Google reads first did not, so a
 *    product whose name carries no type word — «Pasta&Love Strong Hold Mat
 *    Clay» — had the same <title> in Russian and Estonian although he had
 *    written «— глина» and «— juuksevaha».
 * 2. Renat hid the Yumain line on 28.10.2026; «Уход за татуировкой» holds
 *    three of them, and its page drew `url('undefined')` — a request for
 *    /collections/sets/undefined on every view.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getSeoOverride, setSeoOverride } from "@/lib/product-seo";
import { overrideRow, seoPairs } from "../tools/lib/overrides-export.mjs";
import { setupDb, teardownDb } from "./helpers";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("seoPairs() — the build reads «Для Google» as the live page does", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("the Russian pair from its two columns, Estonian and English from seo_langs", () => {
    expect(seoPairs({
      seo_title: "Davines Pasta&Love Strong Hold Mat Clay — глина",
      seo_desc: "Матовая глина для укладки волос.",
      seo_langs: { ET: { title: "Davines Pasta&Love Strong Hold Mat Clay — juuksevaha", desc: "Matt viimistlus." }, EN: { title: "Davines Pasta&Love Strong Hold Mat Clay" } },
    })).toEqual({
      RU: { title: "Davines Pasta&Love Strong Hold Mat Clay — глина", desc: "Матовая глина для укладки волос." },
      ET: { title: "Davines Pasta&Love Strong Hold Mat Clay — juuksevaha", desc: "Matt viimistlus." },
      EN: { title: "Davines Pasta&Love Strong Hold Mat Clay" },
    });
  });

  it("a blank name, brand or section is «not renamed» — an empty brand page would stop the build", () => {
    // tools/chaos-build.mjs, 29.10.2026: a brand of spaces → /ru/b/ → the sitemap check threw
    const r = overrideRow({ price: null, sizes: null, name: "   ", brand: "\t ", cat: " " });
    expect([r.name, r.brand, r.cat]).toEqual([null, null, null]);
    expect(overrideRow({ price: null, sizes: null, name: " Free.Hold — паста " }).name).toBe("Free.Hold — паста");
  });

  it("nothing written is null; seo_langs as a JSON string is read too", () => {
    expect(seoPairs({ seo_title: null, seo_desc: "", seo_langs: null })).toBeNull();
    expect(seoPairs({ seo_langs: '{"ET":{"title":"Pealkiri"}}' })).toEqual({ ET: { title: "Pealkiri" } });
    expect(overrideRow({ price: null, sizes: null, seo_title: "Заголовок" }).seo).toEqual({ RU: { title: "Заголовок" } });
  });

  it("gives exactly what src/lib/product-seo.ts reads from the same row", async () => {
    const id = "davines-pasta-love-strong-hold-mat-clay";
    await setSeoOverride(id, {
      RU: { title: "  Глина​ для   укладки  ", desc: "x".repeat(400) },
      ET: { title: "Savi " + "y".repeat(100) },
      EN: { desc: "Clay\n\nfor styling" },
    });
    const [row] = await query<Record<string, unknown>>("select * from product_overrides where product_id = $1", [id]);
    expect(seoPairs(row)).toEqual(await getSeoOverride(id));
  });

  it("the static product page takes the language's own pair, never another language's", () => {
    const pre = read("../tools/prerender-shop2.mjs");
    expect(pre).toContain("const ownPair = (PRODUCT_OVERRIDES[p.id] && PRODUCT_OVERRIDES[p.id].seo && PRODUCT_OVERRIDES[p.id].seo[code]) || {};");
    // an ET/EN pair with Russian in it (saved before the panel refused one) is skipped
    expect(pre).toContain('const ownSeo = code !== "RU" && /[\\u0400-\\u04FF]/.test((ownPair.title || "") + (ownPair.desc || "")) ? {} : ownPair;');
    expect(pre).toContain('seoTitle: ownSeo.title || (code === "EN" && p.seo && p.seo.t ? p.seo.t : ""),');
    expect(pre).toContain('seoDesc: ownSeo.desc || "",');
  });
});

/* 02.11.2026 — the owner's own page text on the static product page. app.js
   has drawn product_overrides.description since the assistant work; the
   static copy Google reads first carried the old Shopify text, and the live
   page swapped it for his the moment the overrides feed landed. Now both draw
   it with the one renderer (src/lib/desc-format.mjs). */
describe("the owner's description on the static product page", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("the build reads the column exactly as the live feed does", async () => {
    const { getDescriptionOverride, setDescriptionOverride } = await import("@/lib/product-descriptions");
    const id = "proraso-beard-oil-azur-lime-30ml";
    await setDescriptionOverride(id, { RU: "Масло.\r\n\r\n\r\nПреимущества:\n— мягкость\u0007", ET: "  ", EN: "Oil." });
    const [row] = await query<Record<string, unknown>>("select * from product_overrides where product_id = $1", [id]);
    expect(overrideRow(row).description).toEqual(await getDescriptionOverride(id));
    expect(overrideRow({ price: null, sizes: null }).description).toBeNull();
    expect(overrideRow({ price: null, sizes: null, description: '{"ET":"Õli."}' }).description).toEqual({ ET: "Õli." });
  });

  it("descFor() takes his text in the page's language first, drawn by descHtml(), and marks it for app.js", () => {
    const pre = read("../tools/prerender-shop2.mjs");
    expect(pre).toContain('import { descHtml } from "../src/lib/desc-format.mjs";');
    expect(pre).toMatch(/function descFor\(p, code\) \{\s+const own = ownDesc\(p, code\);\s+if \(own\) return descHtml\(own\);/);
    expect(pre).toContain(`'<div class="acc__rich"' + (ownDesc(p, code) ? " data-descown" : "") + ">" + descFor(p, code) + "</div>"`);
    // …and refuses to write pages while app.js carries another copy of the renderer
    expect(pre).toContain("x public/shop2/app.js does not carry the current src/lib/desc-format.mjs block");
    const app = read("../public/shop2/app.js");
    // the static copy stands until the overrides feed has spoken — no flash of the Shopify text
    expect(app).toContain("own: preBox.hasAttribute(\"data-descown\")");
    expect(app).toContain("if (PRE_DESC && PRE_DESC.own && !SRV.ovDone && PRE_DESC.id === p.id && PRE_DESC.lang === S.lang) return PRE_DESC.html;");
  });
});

describe("a set's part photo when the part is off sale", () => {
  const src = read("../public/shop2/app.js");
  function slice(name: string): string {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(name);
  }
  type P = { id: string; img?: string };
  const run = (catalogue: P[], file: P[] | undefined, it: { id: string; img?: string }) =>
    new Function("CATALOGUE", "FILE_PRODUCTS", `${slice("bundleItemProduct")} ${slice("bundleItemImg")} return bundleItemImg(arguments[2]);`)(
      catalogue, file, it,
    ) as string;

  const FOAM = { id: "yumain-aftercare-washing-foam-expert-care-for-your-tattoos", img: "/shop/img/foam-0.webp?v=5" };

  it("the live product's photo while it is on sale", () => {
    expect(run([FOAM], [FOAM], { id: FOAM.id })).toBe(FOAM.img);
  });
  it("the file's own photo once it is hidden — it leaves the catalogue, not the file", () => {
    expect(run([], [FOAM], { id: FOAM.id })).toBe(FOAM.img);
  });
  it("the set's own snapshot, else nothing — never «undefined», and before the file is loaded too", () => {
    expect(run([], [], { id: "gone", img: "/shop/img/x.webp" })).toBe("/shop/img/x.webp");
    expect(run([], [], { id: "gone" })).toBe("");
    expect(run([], undefined, { id: "gone" })).toBe("");
  });
  it("draws no background at all when there is no photo", () => {
    expect(src).toContain("var ph = bundleItemImg(it);");
    expect(src).toContain(`'<span class="ph"' + (ph ? ' style="background-image:url(\\'' + ph + '\\')"' : "") + '></span></span>'`);
    expect(src).not.toContain("(p ? p.img : it.img)");
  });
});
