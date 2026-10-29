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
    expect(pre).toContain("const ownSeo = (PRODUCT_OVERRIDES[p.id] && PRODUCT_OVERRIDES[p.id].seo && PRODUCT_OVERRIDES[p.id].seo[code]) || {};");
    expect(pre).toContain('seoTitle: ownSeo.title || (code === "EN" && p.seo && p.seo.t ? p.seo.t : ""),');
    expect(pre).toContain('seoDesc: ownSeo.desc || "",');
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
