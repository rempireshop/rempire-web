/**
 * «— REMPIRE» once, in every language — verification pass on staging,
 * 25.09.2026: the Estonian article's <title> read «… — REMPIRE — REMPIRE».
 *
 * The article's Estonian Google title came back from the translation already
 * ending in the shop's name, and every page that builds a <title> appends its
 * own « — REMPIRE» (fitTitle() in src/lib/seo-head.mjs for the request-time
 * page and the build, its copy in public/shop2/app.js for the tab once the
 * SPA takes over; a product's own Google title goes through the same ladder).
 * The ladder now takes a trailing brand off before it adds one, and the AI
 * text route no longer hands the editors a title that carries it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPost, upsertPost } from "@/lib/blog";
import { exec } from "@/lib/db";
import { dropBrand, fitTitle, LANGS, productSpec } from "@/lib/seo-head.mjs";
import { setupDb, teardownDb } from "./helpers";

const LIVE = "https://rempireshop.com";
const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
const names = ["dropBrand", "brandOnce"].filter((n) => app.includes(`function ${n}(`));
const appFitTitle = new Function(`${names.map(slice).join("\n")}\n${slice("fitTitle")}\nreturn fitTitle;`)() as typeof fitTitle;

const count = (s: string) => (s.match(/rempire/gi) || []).length;

describe("fitTitle — the site's name once, in the server's copy and in app.js's", () => {
  for (const [where, fit] of [["src/lib/seo-head.mjs", fitTitle], ["public/shop2/app.js", appFitTitle]] as const) {
    it(`${where}: a title that already ends in the brand does not get a second one`, () => {
      // the Estonian article: its seoTitle came back from the translation with the name on it
      const et = "Suvine välimus: hooldus ja stiil — REMPIRE";
      expect(fit("Suvine välimus: hooldus ja stiil", et + " — REMPIRE")).toBe("Suvine välimus: hooldus ja stiil — REMPIRE");
      // a product's own Google title goes through fitTitle(seoTitle, "")
      expect(fit("Nook Bio Botanical Shampoo — šampoon — REMPIRE", "")).toBe("Nook Bio Botanical Shampoo — šampoon — REMPIRE");
      // any separator, any case — and the house form comes out
      expect(fit("Letnij obraz | Rempire", "Letnij obraz | Rempire — REMPIRE")).toBe("Letnij obraz — REMPIRE");
      expect(fit("Summer look - rempireshop.com", "")).toBe("Summer look — REMPIRE");
    });

    it(`${where}: the brand inside a sentence or in front of it is not a tail`, () => {
      expect(fit("Acme Wax", "Acme Wax — купить в Rempire · 9 €", "Acme Wax · 9 €")).toBe("Acme Wax — купить в Rempire · 9 €");
      expect(dropBrand("REMPIRE — магазин косметики в Таллинне")).toBe("REMPIRE — магазин косметики в Таллинне");
      expect(fit("A".repeat(48), "x".repeat(70), "A".repeat(48) + " · от 1 234,56 €")).toBe("A".repeat(48) + " — REMPIRE");
    });
  }

  it("a product page whose Google title was written with the brand carries it once", () => {
    for (const lang of LANGS) {
      const spec = productSpec({
        base: LIVE, lang, id: "x", cat: "hair", catName: "Уход за волосами",
        brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, priceFrom: true,
        stock: "in", body: "<p>Шампунь.</p>", image: "", imageUrls: [],
        seoTitle: "System 4 Bio Botanical Shampoo — REMPIRE", seoDesc: "",
      });
      expect(count(spec.title), `${lang.code}: ${spec.title}`).toBe(1);
    }
  });

  it("dropBrand leaves a title without the brand as it is", () => {
    expect(dropBrand("Уход за бородой зимой")).toBe("Уход за бородой зимой");
    expect(dropBrand("Уход за бородой зимой — REMPIRE — REMPIRE")).toBe("Уход за бородой зимой");
  });
});

describe("an article's page at request time, in all three languages", () => {
  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = LIVE;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await exec("truncate posts, custom_products restart identity cascade");
  });

  it("a Google title that ends in the brand — as the translation wrote it — gives a <title> with it once", async () => {
    const row = await upsertPost({
      title: { RU: "Летний образ: уход и стиль", ET: "Suvine välimus: hooldus ja stiil", EN: "Summer look: care and style" },
      excerpt: { RU: "Коротко.", ET: "Lühidalt.", EN: "In short." },
      body: { RU: "<p>Текст.</p>", ET: "<p>Tekst.</p>", EN: "<p>Text.</p>" },
      seoTitle: { RU: "Летний образ — REMPIRE", ET: "Suvine välimus: hooldus ja stiil — REMPIRE", EN: "Summer look | Rempire" },
    });
    const post = (await publishPost(row.id))!;
    for (const seg of ["", "et", "en"] as const) {
      const mod = seg === "et"
        ? await import("@/app/shop2/et/blog/[slug]/route")
        : seg === "en" ? await import("@/app/shop2/en/blog/[slug]/route") : await import("@/app/shop2/blog/[slug]/route");
      const res = await mod.GET(new Request(`${LIVE}/shop2${seg ? "/" + seg : ""}/blog/${post.slug}/`), { params: Promise.resolve({ slug: post.slug }) });
      const html = await res.text();
      const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "";
      expect(count(title), `${seg || "ru"}: ${title}`).toBe(1);
      expect(title, seg || "ru").toMatch(/ — REMPIRE$/);
    }
  });
});

describe("the AI text route hands the editors a Google title without the brand", () => {
  it("strips a trailing «— REMPIRE» from the snippet, the article's and the outline's title", () => {
    const route = readFileSync(fileURLToPath(new URL("../src/app/api/admin/ai/text/route.ts", import.meta.url)), "utf8");
    expect(route).toContain("title: dropBrand(seoProductName(title, lang)).slice(0, 70)");
    expect(route).toContain("seo: { title: dropBrand(str(p.seoTitle, 70))");
    expect(route).toContain("meta: { title: dropBrand(str(p.metaTitle, 70))");
  });
});
