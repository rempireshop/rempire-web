/**
 * A catalogue product's name, brand and section are the owner's to change
 * (Renat 26.10.2026: «Не могу поменять название»; Dim: he runs the shop
 * himself after the handover). db/migrations/224_override_name_brand_cat.sql
 * gives product_overrides the three columns; the product card opens «Что за
 * товар» for every product.
 *
 * What has to hold:
 *   · the rename is stored, served to the shop, and refused when a language
 *     could not say it (a type word the tables do not know would stay Russian
 *     on the Estonian and English pages and in the feed — Dim: block it,
 *     suggest the words);
 *   · the id never changes — page address, feed offer id, stock key;
 *   · an order bought after the rename carries the new name, the feed, the
 *     static build and the scanner name it so;
 *   · «Вернуть» in the journal puts the old name back.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { getOrder, listAudit } from "@/lib/orders";
import { journalRows } from "@/lib/audit-undo";
import { nameTranslatable } from "@/lib/product-name";
import { withOwnerNames } from "@/lib/seo-head.mjs";
import { overrideRow } from "../tools/lib/overrides-export.mjs";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const ID = "system-4-bio-botanical-shampoo";
let admin = "";
let ipN = 0;
const freshIp = () => `203.0.113.${(ipN++ % 200) + 1}`;

function req(path: string, method: string, body?: unknown, cookie: string | null = admin) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": freshIp() };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function put(body: unknown) {
  const { PUT } = await import("@/app/api/admin/overrides/route");
  const res = await PUT(req("/api/admin/overrides/", "PUT", body));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("a name every language can say", () => {
  it("is a Latin line and a type word the tables know", () => {
    expect(nameTranslatable("Bio Botanical Shampoo — шампунь")).toBe(true);
    expect(nameTranslatable("White — бальзам после бритья")).toBe(true);
    expect(nameTranslatable("Chocolate Hair Mask")).toBe(true);
    expect(nameTranslatable("Чёрное мыло 666 — ручная работа")).toBe(true);
  });
  it("is not a type word the tables have never seen, nor a Russian line", () => {
    expect(nameTranslatable("White — эликсир после бритья")).toBe(false);
    expect(nameTranslatable("Белый бальзам — бальзам после бритья")).toBe(false);
  });
});

describe("the build folds the rename in", () => {
  it("overrideRow carries the three fields, and withOwnerNames puts them on the product", () => {
    const row = overrideRow({ price: null, sizes: null, hidden: false, stock: null, subcat: null, name: "White — бальзам", brand: "Proraso", cat: "beard" });
    expect(row).toMatchObject({ name: "White — бальзам", brand: "Proraso", cat: "beard" });
    const list = [{ id: "a", name: "Old — бальзам", brand: "Old", cat: "hair", stock: "in" }, { id: "b", name: "Keep", brand: "K", cat: "hair" }];
    const out = withOwnerNames(list, { a: { name: "New — бальзам", brand: null, cat: "beard" } });
    expect(out[0]).toMatchObject({ id: "a", name: "New — бальзам", brand: "Old", cat: "beard" });
    expect(out[1]).toBe(list[1]);
  });
});

describe("PUT /api/admin/overrides — name, brand, section", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await truncateAll();
  });
  afterEach(() => vi.restoreAllMocks());

  it("stores a rename, serves it to the shop, and a new section starts at «Авто»", async () => {
    await put({ id: ID, subcat: "shampoo-oily" });
    const r = await put({ id: ID, name: "Bio Botanical Shampoo №1 — шампунь", brand: "System 4 Bio", cat: "beard" });
    expect(r.status).toBe(200);
    const { GET } = await import("@/app/api/overrides/route");
    const pub = (await (await GET()).json()) as { overrides: Record<string, Record<string, unknown>> };
    expect(pub.overrides[ID]).toMatchObject({ name: "Bio Botanical Shampoo №1 — шампунь", brand: "System 4 Bio", cat: "beard", subcat: null });
  });

  it("refuses a name a language could not say, a section that does not exist, and the owner's own product", async () => {
    expect((await put({ id: ID, name: "Shampoo — эликсир свежести" })).body.error).toBe("name_untranslatable");
    expect((await put({ id: ID, cat: "kitchen" })).status).toBe(400);
    expect((await put({ id: "c-own-product", name: "X — шампунь" })).status).toBe(400);
    const rows = await query<{ name: string | null }>("select name from product_overrides where product_id = $1", [ID]);
    expect(rows[0]?.name ?? null).toBeNull();
  });

  it("an empty value gives the field back to the catalogue", async () => {
    await put({ id: ID, name: "Renamed — шампунь" });
    await put({ id: ID, name: "" });
    const rows = await query<{ name: string | null }>("select name from product_overrides where product_id = $1", [ID]);
    expect(rows[0].name).toBeNull();
  });

  it("an order bought after the rename carries the new name and brand", async () => {
    await put({ id: ID, name: "Bio Botanical Shampoo №1 — шампунь", brand: "Sim Sensitive" });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(req("/api/orders/", "POST", {
      lang: "RU", items: [{ id: ID, variant: "250 мл", qty: 1 }],
      customer: { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" },
      shipping: { method: "pickup", country: "EE" },
    }, null));
    expect(res.status).toBe(201);
    const o = await getOrder(String(((await res.json()) as { orderId: string }).orderId));
    expect(o?.items[0]).toMatchObject({ id: ID, title: "Bio Botanical Shampoo №1 — шампунь", brand: "Sim Sensitive" });
  });

  it("the feed and the connector name it so, under the same id", async () => {
    await put({ id: ID, name: "Bio Botanical Shampoo №1 — шампунь", brand: "Sim Sensitive" });
    const { loadFeedInput, shopProducts } = await import("@/lib/merchant-feed");
    const p = shopProducts(await loadFeedInput(), ORIGIN).find((x) => x.id === ID);
    expect(p).toMatchObject({ id: ID, brand: "Sim Sensitive" });
    expect(p!.names.RU).toBe("Bio Botanical Shampoo №1 — шампунь");
    expect(p!.names.ET).toBe("Bio Botanical Shampoo №1 — šampoon");
  });

  it("«Вернуть» in the journal puts the old name back", async () => {
    await put({ id: ID, name: "First — шампунь" });
    await put({ id: ID, name: "Second — шампунь" });
    const row = journalRows(await listAudit(10)).find((x) => x.action === "override.set" && (x.payload as { patch?: { name?: string } }).patch?.name === "Second — шампунь");
    expect(row?.undo).toEqual({ kind: "override", id: ID, patch: { name: "First — шампунь" } });
  });
});

describe("the product card (public/shop2/app.js)", () => {
  const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  const sliceFn = (name: string): string => {
    const start = APP.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = APP.indexOf("{", start); i < APP.length; i++) {
      if (APP[i] === "{") depth++;
      else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const lit = (marker: string, end: string) => {
    const at = APP.indexOf(marker);
    return APP.slice(at + marker.length, APP.indexOf(end, at) + end.length).replace(/;\s*$/, "");
  };
  const ctx = runInNewContext(
    `var NAME_TAILS = ${lit("var NAME_TAILS = ", "\n  };")}; var TAIL_EXACT = ${lit("var TAIL_EXACT = ", "\n  };")}; var NAME_FRAGS = ${lit("var NAME_FRAGS = ", "\n  ];")};
     ${sliceFn("trName")} ${sliceFn("nameSaysAll")} ${sliceFn("nameTailSuggest")} ${sliceFn("edNameHintText")}
     ({ nameSaysAll: nameSaysAll, nameTailSuggest: nameTailSuggest, hint: edNameHintText })`,
  ) as { nameSaysAll: (s: string) => boolean; nameTailSuggest: (s: string) => string[]; hint: (s: string) => string };

  it("knows what every language can say, as the server does", () => {
    for (const n of ["White — бальзам после бритья", "Chocolate Hair Mask", "Bio Botanical Shampoo — шампунь"]) {
      expect(ctx.nameSaysAll(n), n).toBe(nameTranslatable(n));
      expect(ctx.nameSaysAll(n)).toBe(true);
    }
    expect(ctx.nameSaysAll("White — эликсир после бритья")).toBe(false);
  });

  it("suggests the known words closest to the one typed", () => {
    const like = ctx.nameTailSuggest("White — бальзамчик для бритья");
    expect(like.length).toBeGreaterThan(0);
    expect(like.every((w) => w.startsWith("баль"))).toBe(true);
    expect(ctx.hint("White — бальзамчик для бритья")).toMatch(/^Хвост после « — » не переведётся сам\. Похожие: баль/);
  });

  it("opens «Что за товар» for every product, and the lock note is gone", () => {
    expect(APP).toContain("      edSecWhat(p) +");
    expect(APP).not.toContain("их меняет Дим. Всё остальное здесь меняете вы.\") +");
    expect(APP).toContain('if (a.type === "set_names") return edApi(ov, "PUT", namesBody(a), ka);');
  });
});
