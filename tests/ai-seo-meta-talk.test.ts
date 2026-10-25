/**
 * «Заполнить автоматически» for a product's Google text wrote about the data
 * instead of the product (Renat's videos, 25.10.2026): the goods editor sent
 * the model the name, brand and section only, the prompt said «nothing that
 * is not in INPUT», and 29 products went live with «Других сведений о
 * продукте нет», «Toote kohta pole lisateavet», «The catalogue gives no
 * further product details», even «В INPUT нет данных…».
 *
 * Now the description goes with the request (seoSummaryFor() in app.js), the
 * prompt forbids talk about missing data, and seoDropMetaTalk() drops such a
 * sentence if one still comes back. The strings below are the live ones.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSeoPrompt, seoDropMetaTalk } from "@/lib/ai-prompts";

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const ROUTE = readFileSync(fileURLToPath(new URL("../src/app/api/admin/ai/text/route.ts", import.meta.url)), "utf8");

describe("a sentence about the data, not the product", () => {
  it.each([
    ["Кондиционер для ухода за волосами. Других сведений о продукте нет.", "Кондиционер для ухода за волосами."],
    ["Шампунь Bio Botanical от System 4 для ухода за волосами. Других характеристик продукта в описании нет.", "Шампунь Bio Botanical от System 4 для ухода за волосами."],
    ["Глина для укладки волос от Kevin.Murphy. В INPUT нет данных о том, кому она подходит или чем отличается.", "Глина для укладки волос от Kevin.Murphy."],
    ["Шампунь Kevin.Murphy Maxi.Wash для ухода за волосами. Другие особенности продукта не указаны.", "Шампунь Kevin.Murphy Maxi.Wash для ухода за волосами."],
    ["Шампунь для ухода за волосами. В названии продукта указано Repair-Me.Wash.", "Шампунь для ухода за волосами."],
    ["Spreivaha juuste kujundamiseks. Toote omaduste ja sobivuse kohta pole lisateavet.", "Spreivaha juuste kujundamiseks."],
    ["System 4 Hydro Care Conditioner H on juuksepalsam. Lisainfo selle sobivuse või omaduste kohta puudub.", "System 4 Hydro Care Conditioner H on juuksepalsam."],
    ["Killer.Curls Rinse on palsam juuksehoolduseks. Rohkem toote omadusi pole kirjeldatud.", "Killer.Curls Rinse on palsam juuksehoolduseks."],
    ["Juuste viimistlustoode. Toote nimi on Moving Rubber Wild Shake.", "Juuste viimistlustoode."],
    ["A styling paste for hair. The catalogue gives no further product details.", "A styling paste for hair."],
    ["Un.Tangled Spray is a hair spray for anyone looking for hair care. Its specific benefits are not listed.", "Un.Tangled Spray is a hair spray for anyone looking for hair care."],
    ["A styling paste for hair. Its name is Free.Hold.", "A styling paste for hair."],
    ["A shampoo for hair care. Choose it by its name: Special Shampoo 1.", "A shampoo for hair care."],
  ])("drops it from «%s»", (text, kept) => {
    expect(seoDropMetaTalk(text)).toBe(kept);
  });

  it("keeps a snippet that talks about the product", () => {
    for (const text of [
      "Cухая моделирующая глина сильной фиксации для текстурных укладок от Kevin.Murphy.",
      "Бессульфатный шампунь Kevin.Murphy для укладки феном: увлажняет и защищает волосы от высоких температур.",
      "A curl cream for styling curly hair. Killer.Twirls helps define curls and reduce frizz.",
      "Vormiv geel juuste viimistlemiseks. Sobib sulle, kui otsid viimistlustoodet, mis aitab juukseid vormida.",
    ]) expect(seoDropMetaTalk(text)).toBe(text);
  });

  it("leaves nothing when there was nothing else — the route refuses that snippet", () => {
    expect(seoDropMetaTalk("Других сведений о продукте нет.")).toBe("");
    expect(ROUTE).toContain("seoDropMetaTalk(t.description)");
    expect(ROUTE).toContain('error: "empty_snippet"');
  });
});

describe("the request", () => {
  it("carries the description, and the prompt writes from it", () => {
    const { system, user } = buildSeoPrompt("ET", {
      kind: "product", name: "Blow.Dry Wash — шампунь", brand: "Kevin.Murphy", category: "Уход за волосами",
      summary: "Бессульфатный шампунь, увлажняет и защищает волосы от высоких температур.",
    });
    expect(user).toContain("Бессульфатный шампунь, увлажняет");
    expect(user).toContain("the facts to write from");
    expect(system).toContain("Never write about what INPUT lacks");
    expect(system).not.toContain("Nothing that is not in INPUT.");
  });

  it("is sent with the description by the goods editor's button", () => {
    expect(APP).toContain("summary: seoSummaryFor(p, L)");
    expect(APP).toContain("function seoSummaryFor(p, L)");
    expect(APP).toContain("contentWantAll().then(send, send)");
  });
});
