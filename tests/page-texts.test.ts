/**
 * «Тексты страниц» — the owner's own words for the section and brand pages
 * (Dim, 26.10.2026: «he needs to be able to manage it from somewhere»):
 * settings.page_texts (src/lib/page-texts.mjs), laid over the approved copy
 * by the shared seo-copy block (seoOwnSet / seoOwn) in the prerender, the
 * shop and Renat's Claude alike.
 *
 * What has to hold:
 *   · the stored document is only what the pages print, at the lengths they
 *     print it — whoever writes;
 *   · a field the owner wrote wins, in its language only; everything else is
 *     the approved copy, exactly as before;
 *   · the section lines moved from app.js (CAT_INTROS + dictionary) into the
 *     block without a word changing;
 *   · the settings route cleans the key, the public feed carries it, the
 *     prerender and the shop read it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { cleanPageTexts, PAGE_TEXT_CATS } from "@/lib/page-texts.mjs";
import { seoBrandIntro, seoCatIntro, seoCatLines, seoHead, seoOwnSet } from "@/lib/seo-copy.mjs";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("cleanPageTexts", () => {
  it("keeps the three fields per language, drops what no page prints", () => {
    const out = cleanPageTexts({
      cat: {
        hair: { RU: { title: "  Шампуни  ", desc: "", intro: "Строка\nвторая", extra: "x" }, DE: { title: "Haar" } },
        kitchen: { RU: { title: "Кухня" } },
      },
      brand: { "System 4": { ET: { intro: "Soome sari." } }, "  ": { RU: { title: "x" } } },
      other: { a: 1 },
    });
    expect(out).toEqual({
      cat: { hair: { RU: { title: "Шампуни", intro: "Строка вторая" } } },
      brand: { "System 4": { ET: { intro: "Soome sari." } } },
    });
  });
  it("never takes a key that would reach an object's prototype", () => {
    // a request body arrives through JSON.parse, where «__proto__» is an own key
    const out = cleanPageTexts(JSON.parse('{"brand":{"__proto__":{"RU":{"title":"x"}},"Byredo":{"EN":{"title":"Byredo"}}}}'));
    expect(Object.keys(out.brand)).toEqual(["Byredo"]);
    expect(Object.getPrototypeOf(out.brand)).toBe(Object.prototype);
  });
  it("cuts at the lengths the pages print and refuses nothing", () => {
    const out = cleanPageTexts({ cat: { beard: { EN: { title: "T".repeat(90), desc: "D".repeat(300), intro: "I".repeat(2000) } } } });
    expect(out.cat.beard.EN).toEqual({ title: "T".repeat(70), desc: "D".repeat(170), intro: "I".repeat(1200) });
    expect(cleanPageTexts(null)).toEqual({ cat: {}, brand: {} });
    expect(cleanPageTexts("x")).toEqual({ cat: {}, brand: {} });
  });
});

describe("the shared block lays the owner's words over the approved copy", () => {
  afterEach(() => seoOwnSet(null));

  it("a field he wrote wins in its language; the rest is the copy as before", () => {
    const before = { hairET: seoHead("cat", "hair", "ET", null), hairRU: seoHead("cat", "hair", "RU", null), s4: seoHead("brand", "System 4", "EN", null) };
    seoOwnSet(cleanPageTexts({
      cat: { hair: { ET: { title: "Juuksehooldus Tallinnas", intro: "Meie salongi valik." } } },
      brand: { "System 4": { EN: { desc: "System 4 scalp care from Finland, in stock in Tallinn." } } },
    }));
    expect(seoHead("cat", "hair", "ET", null).t).toBe("Juuksehooldus Tallinnas");
    expect(seoHead("cat", "hair", "ET", null).d).toBe(before.hairET.d);
    expect(seoHead("cat", "hair", "RU", null)).toEqual(before.hairRU);
    expect(seoCatIntro("hair", "ET")).toBe("Meie salongi valik.");
    expect(seoCatIntro("hair", "RU")).toBe(seoCatLines().hair.RU);
    const s4 = seoHead("brand", "System 4", "EN", null);
    expect(s4.t).toBe(before.s4.t);
    expect(s4.d).toBe("System 4 scalp care from Finland, in stock in Tallinn.");
    expect(seoBrandIntro("System 4", "RU")).toContain("Sim Sensitive");
  });

  it("the section lines moved out of app.js without a word changing", () => {
    const app = read("../public/shop2/app.js");
    const m = /var CAT_INTROS = \{([\s\S]*?)\n {2}\};/.exec(app)!;
    const ru: Record<string, string> = {};
    for (const l of m[1].split("\n")) {
      const x = /^\s*(\w+): "(.*)",?$/.exec(l);
      if (x) ru[x[1]] = x[2];
    }
    const lines = seoCatLines() as Record<string, Record<string, string>>;
    expect(Object.keys(lines).sort()).toEqual([...PAGE_TEXT_CATS].sort());
    for (const [cat, text] of Object.entries(ru)) {
      expect(lines[cat].RU).toBe(text);
      // the dictionary's ET and EN for that Russian line are the block's
      for (const want of [lines[cat].ET, lines[cat].EN]) expect(app).toContain(`${JSON.stringify(text)}: ${JSON.stringify(want)}`);
    }
  });

  it("the prerender and the shop read the same document", () => {
    const prerender = read("../tools/prerender-shop2.mjs");
    expect(prerender).toContain('fetchSettings(["shipping_rules", "pricing", "gift_amounts", "content", "page_texts"])');
    expect(prerender).toContain("seoOwnSet(cleanPageTexts(LIVE_SETTINGS.page_texts));");
    expect(prerender).toContain("intro: seoCatIntro(c, lang.code) ||");
    const app = read("../public/shop2/app.js");
    expect(app).toContain('if (fed("page_texts")) seoOwnSet(');
    expect(app).toContain("seoBrandIntro(S.brand, S.lang) : seoCatIntro(S.cat, S.lang)");
  });
});

describe("settings.page_texts on the server", () => {
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  it("the settings route stores it cleaned, and the public feed carries it", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const res = await PUT(new Request("https://rempireshop.com/api/admin/settings/", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin, "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ settings: { page_texts: { cat: { beard: { RU: { intro: "  Борода  ", junk: 1 } }, sauna: { RU: { title: "x" } } } } } }),
    }));
    expect(res.status).toBe(200);
    const { GET } = await import("@/app/api/overrides/route");
    const pub = (await (await GET()).json()) as { settings: Record<string, unknown> };
    expect(pub.settings.page_texts).toEqual({ cat: { beard: { RU: { intro: "Борода" } } }, brand: {} });
  });
});
