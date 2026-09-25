/**
 * «Аналитика → Топ товаров» names a set and a gift card, not their ids.
 *
 * Verification pass on staging, 25.09.2026 (stats-ranges): the list read
 * «bundle:hair-shampoo-set», «bundle:beard», «gift:50». A set is sold as one
 * basket line «bundle:<id>» and a gift card as «gift:<amount>»; neither is in
 * the catalogue, so productInfo() handed the id back as the name. Now a set
 * is its own name in all three languages (`names`, which the panel picks by
 * its language) and a gift card «Подарочная карта 50 €», which the panel's
 * dictionary says in ET and EN.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { getAnalyticsSummary } from "@/lib/analytics";
import { upsertBundle, validateBundle } from "@/lib/bundles";
import { query } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; p: number; s: string };
const VARIANTS = variants as Record<string, { sizes: string[] }>;
const inStock = (catalogueMin as Min[]).filter((p) => p.s === "in" && !VARIANTS[p.id]);
const [A, B] = inStock;
const NOW = new Date("2026-06-15T12:00:00Z");

async function paid(items: unknown[], total: number, n: number) {
  await query(
    `insert into orders (number, lang, email, name, status, items, subtotal, total, created_at)
     values ($1, 'RU', 'maria@example.com', 'Мария', 'paid', $2::jsonb, $3, $3, $4)`,
    [`R-9${String(n).padStart(5, "0")}`, JSON.stringify(items), total, new Date(NOW.getTime() - 86_400_000).toISOString()],
  );
}

describe("the top list's names (PGlite)", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
    const check = validateBundle({
      id: "test-top-set", cat: "beard",
      title: { RU: "Борода — стартовый набор", ET: "Habeme stardikomplekt", EN: "Beard starter set" },
      desc: { RU: "", ET: "", EN: "" },
      items: [{ productId: A.id, variant: 0, qty: 1 }, { productId: B.id, variant: 0, qty: 1 }],
      price: 30, active: true, sort: 99,
    });
    if (!check.ok) throw new Error("fixture: " + check.error);
    await upsertBundle(check.value);
    await paid([{ id: "bundle:test-top-set", kind: "bundle", title: "Борода — стартовый набор", qty: 2, price: 30, sum: 60 }], 60, 1);
    await paid([{ id: "gift:50", kind: "gift", title: "Подарочная карта", qty: 1, price: 50, sum: 50 }], 50, 2);
    // a set deleted since: only the title its line was sold under is left
    await paid([{ id: "bundle:gone-set", kind: "bundle", title: "Старый набор", qty: 1, price: 40, sum: 40 }], 40, 3);
    await paid([{ id: A.id, qty: 1, price: 10, sum: 10 }], 10, 4);
  });
  afterAll(teardownDb);

  it("a set by its name in each language, a gift card by its amount — never the id", async () => {
    const s = await getAnalyticsSummary("7d", NOW);
    const byId = new Map(s.topProductsByRevenue.map((r) => [r.id, r]));
    expect(byId.get("bundle:test-top-set")).toMatchObject({
      name: "Борода — стартовый набор", brand: "", revenue: 60,
      names: { RU: "Борода — стартовый набор", ET: "Habeme stardikomplekt", EN: "Beard starter set" },
    });
    expect(byId.get("gift:50")).toMatchObject({ name: "Подарочная карта 50 €", brand: "", revenue: 50 });
    expect(byId.get("bundle:gone-set")).toMatchObject({ name: "Старый набор", brand: "" });
    for (const r of s.topProductsByRevenue) expect(r.name, r.id).not.toMatch(/^(bundle|gift):/);
    // …and a product is still a product
    expect(byId.get(A.id)).toMatchObject({ name: A.n, brand: A.b });
  });
});

/* ------------------------------------------------------------------------ */

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

describe("the panel shows them in its own language", () => {
  const trText = runInNewContext(`
    var UI = ${sliceLiteral("var UI = ", "\n  };")};
    var UI_RX = ${sliceLiteral("var UI_RX = ", "\n  ];")};
    var NAME_TAILS = ${sliceLiteral("var NAME_TAILS = ", "\n  };")};
    var NAME_FRAGS = ${sliceLiteral("var NAME_FRAGS = ", "\n  ];")};
    var TAIL_EXACT = ${sliceLiteral("var TAIL_EXACT = ", "\n  };")};
    ${slice("trName")}
    ${slice("trText")}
    trText`) as (s: string, lang: string, allowName: boolean) => string;

  it("«Подарочная карта 50 €» in Estonian and English", () => {
    expect(trText("Подарочная карта 50 €", "ET", false)).toBe("Kinkekaart 50 €");
    expect(trText("Подарочная карта 50 €", "EN", false)).toBe("Gift card 50 €");
    expect(trText("Подарочная карта 100 €", "EN", false)).toBe("Gift card 100 €");
  });

  it("a set's row takes the name in the panel's language", () => {
    const stats = slice("admStatsScreen");
    expect(stats).toContain("var nm = (p.names && p.names[S.lang]) || p.name;");
  });
});
