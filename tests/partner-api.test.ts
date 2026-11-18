/**
 * /api/partner/* — the booking app's side door (docs/partner-api.md), the
 * read-only version: it looks products up and matches a photo, and writes
 * nothing.
 *
 *   · the shared secret: 503 unset, 401 wrong, 200 right, never cached;
 *   · GET /api/partner/products/lookup by barcode, by text, by id — hidden
 *     and «нет в наличии» products still answer, at the till's price;
 *   · purchaseCents is always null in this version;
 *   · POST /api/partner/products/identify with OpenAI stubbed (never called
 *     for real), 503 without a key, 413 over 2 MB;
 *   · the budget: 120 lookups a minute, 20 photo matches a minute and 500 a
 *     day, 429 with Retry-After past it;
 *   · neither route changes a single row of the database.
 *
 * Fake data only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { move, setLevel } from "@/lib/inventory";
import { upsertOverride } from "@/lib/orders";
import { PARTNER_LIMITS, partnerOverBudget } from "@/lib/partner-auth";
import { identifyCandidates, loadPartnerCatalog } from "@/lib/partner-products";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; p: number; s: string };
type Ladder = { sizes: string[]; prices: number[] };
const CAT = catalogueMin as Min[];
const LADDERS = variantData as Record<string, Ladder>;
/** No size ladder at all: its shelf row is ''. */
const PLAIN = CAT.find((p) => !LADDERS[p.id] && p.s === "in")!;
/** Three sizes, each with its own price. */
const SIZED = CAT.find((p) => (LADDERS[p.id]?.sizes.length ?? 0) >= 2 && p.s === "in")!;
const SIZE = LADDERS[SIZED.id].sizes[1];
const SIZE_PRICE = LADDERS[SIZED.id].prices[1];
/** A third, for the hidden-product cases. */
const OTHER = CAT.find((p) => !LADDERS[p.id] && p.s === "in" && p.id !== PLAIN.id && p.b !== PLAIN.b)!;

const ORIGIN = "https://rempireshop.com";
const SECRET = "test-booking-secret-0123456789";
const AUTH = { authorization: `Bearer ${SECRET}` };
const EAN = "4006381333931";
/* a real 1×1 PNG */
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const IMAGE = `data:image/png;base64,${PNG_B64}`;

function get(path: string, headers: Record<string, string> = AUTH) {
  return new Request(`${ORIGIN}${path}`, { headers });
}
function post(path: string, body: unknown, headers: Record<string, string> = AUTH) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const lookup = async (qs: string, headers?: Record<string, string>) => {
  const { GET } = await import("@/app/api/partner/products/lookup/route");
  return GET(get(`/api/partner/products/lookup${qs}`, headers));
};
const identify = async (body: unknown, headers?: Record<string, string>) => {
  const { POST } = await import("@/app/api/partner/products/identify/route");
  return POST(post("/api/partner/products/identify", body, headers));
};
const itemsOf = async (res: Response) => (await res.json()).items as Array<Record<string, unknown>>;

/** A model that always answers «no match» — enough for the budget tests. */
const noMatchModel = () => vi.fn(async () => Response.json({ choices: [{ message: { content: '{"matches":[]}' } }] }));

/** Every row of every table, as one fingerprint per table. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await query<{ t: string }>(
    "select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [row] = await query<{ h: string | null }>(`select md5(string_agg(x::text, '|' order by x::text)) as h from "${t}" x`);
    out[t] = row?.h ?? "";
  }
  return out;
}

describe("/api/partner/* (read-only)", () => {
  let savedOpenAi: string | undefined;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.BOOKING_API_SECRET = SECRET;
    savedOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await setupDb();
  });
  afterAll(async () => {
    delete process.env.BOOKING_API_SECRET;
    if (savedOpenAi !== undefined) process.env.OPENAI_API_KEY = savedOpenAi;
    await teardownDb();
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.BOOKING_API_SECRET = SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  /* ---------- the key ---------------------------------------------------- */

  describe("the shared secret", () => {
    it("503 not_configured while BOOKING_API_SECRET is unset — or too short to be a secret", async () => {
      delete process.env.BOOKING_API_SECRET;
      for (const res of [await lookup(`?id=${PLAIN.id}`), await identify({ image: "x" })]) {
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "not_configured" });
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      process.env.BOOKING_API_SECRET = "short";
      expect((await lookup(`?id=${PLAIN.id}`)).status).toBe(503);
    });

    it("401 unauthorized without it, with another value, or without «Bearer»", async () => {
      const wrong: Array<Record<string, string>> = [
        {},
        { authorization: "Bearer nope" },
        { authorization: `Bearer ${SECRET}x` },
        { authorization: SECRET },
        { authorization: `Basic ${SECRET}` },
      ];
      for (const h of wrong) {
        for (const res of [await lookup(`?id=${PLAIN.id}`, h), await identify({ image: "x" }, h)]) {
          expect(res.status).toBe(401);
          expect(await res.json()).toEqual({ error: "unauthorized" });
          expect(res.headers.get("cache-control")).toBe("no-store");
        }
      }
    });

    it("200 with it, and the answer is never cached", async () => {
      const res = await lookup(`?id=${PLAIN.id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  /* ---------- lookup ----------------------------------------------------- */

  describe("GET /api/partner/products/lookup", () => {
    it("by id: one size, priced the way the till prices it, nothing counted yet, no purchase price", async () => {
      const body = await (await lookup(`?id=${PLAIN.id}`)).json();
      expect(body.items).toHaveLength(1);
      const p = body.items[0];
      expect(p).toMatchObject({
        productId: PLAIN.id,
        variant: "",
        variantLabel: "",
        name: PLAIN.n,
        brand: PLAIN.b,
        priceCents: Math.round(PLAIN.p * 100),
        purchaseCents: null,
        vatBp: 2400,
        stock: null,
        barcode: null,
      });
      expect(p.photo).toMatch(/^https:\/\/rempireshop\.com\/.+/);
      expect(Object.keys(p).sort()).toEqual(
        ["barcode", "brand", "name", "photo", "priceCents", "productId", "purchaseCents", "stock", "variant", "variantLabel", "vatBp"].sort(),
      );
    });

    it("by id and size: that size's own price, its label in the asked language", async () => {
      const ru = await itemsOf(await lookup(`?id=${SIZED.id}&variant=${encodeURIComponent(SIZE)}`));
      expect(ru).toHaveLength(1);
      expect(ru[0]).toMatchObject({ productId: SIZED.id, variant: SIZE, variantLabel: SIZE, priceCents: Math.round(SIZE_PRICE * 100) });

      const en = (await itemsOf(await lookup(`?id=${SIZED.id}&variant=${encodeURIComponent(SIZE)}&lang=en`)))[0];
      expect(en.variant).toBe(SIZE); // the key never changes with the language
      expect(en.variantLabel).not.toMatch(/[а-яё]/i);
      expect(en.name).not.toMatch(/[а-яё]/i);

      // a size the product does not have is no product at all
      expect(await itemsOf(await lookup(`?id=${SIZED.id}&variant=999%20мл`))).toEqual([]);
      expect(await itemsOf(await lookup("?id=no-such-product"))).toEqual([]);
    });

    it("carries the count and the barcode once «Склад» has them; purchaseCents stays null", async () => {
      await move({ productId: PLAIN.id, delta: 7, reason: "goods_in" });
      await setLevel(PLAIN.id, "", { ean: EAN });
      const p = (await itemsOf(await lookup(`?id=${PLAIN.id}`)))[0];
      expect(p).toMatchObject({ stock: 7, barcode: EAN, purchaseCents: null });
    });

    it("by barcode: the size the code is bound to; an unknown code finds nothing", async () => {
      await setLevel(SIZED.id, SIZE, { ean: EAN });
      const items = await itemsOf(await lookup(`?barcode=${EAN}`));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ productId: SIZED.id, variant: SIZE, barcode: EAN });
      expect(await itemsOf(await lookup("?barcode=5000000000000"))).toEqual([]);
    });

    it("by text: brand and name words, on-sale products only, at most `limit`", async () => {
      const brandWord = PLAIN.b.split(/\s+/)[0];
      const items = (await itemsOf(await lookup(`?q=${encodeURIComponent(brandWord)}&limit=20`))) as Array<{ productId: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(20);
      expect(items.some((p) => p.productId === PLAIN.id)).toBe(true);

      const one = await itemsOf(await lookup(`?q=${encodeURIComponent(brandWord)}&limit=1`));
      expect(one).toHaveLength(1);

      // «Показывать в магазине» off: gone from the search, still found by id and barcode
      await upsertOverride(PLAIN.id, { hidden: true });
      const after = (await itemsOf(await lookup(`?q=${encodeURIComponent(brandWord)}&limit=20`))) as Array<{ productId: string }>;
      expect(after.some((p) => p.productId === PLAIN.id)).toBe(false);
      expect(await itemsOf(await lookup(`?id=${PLAIN.id}`))).toHaveLength(1);
    });

    it("a bottle the till will not ring up — hidden, «нет в наличии», counted to zero — keeps the price it had", async () => {
      /* the owner's own price, so the size premium has to be carried over too */
      await upsertOverride(SIZED.id, { price: SIZED.p + 3 });
      await setLevel(SIZED.id, SIZE, { ean: EAN });
      const before = (await itemsOf(await lookup(`?barcode=${EAN}`)))[0];
      expect(before.priceCents).toBe(Math.round((SIZE_PRICE + 3) * 100));
      const plainBefore = (await itemsOf(await lookup(`?id=${PLAIN.id}`)))[0];
      const otherBefore = (await itemsOf(await lookup(`?id=${OTHER.id}`)))[0];

      await upsertOverride(SIZED.id, { hidden: true });
      await upsertOverride(OTHER.id, { stock: "out" });
      await move({ productId: PLAIN.id, delta: 2, reason: "goods_in" });
      await move({ productId: PLAIN.id, delta: -2, reason: "adjust" });

      const hidden = await itemsOf(await lookup(`?barcode=${EAN}`));
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toMatchObject({ productId: SIZED.id, variant: SIZE, priceCents: before.priceCents });
      expect((await itemsOf(await lookup(`?id=${SIZED.id}&variant=${encodeURIComponent(SIZE)}`)))[0]?.priceCents).toBe(before.priceCents);

      const out = await itemsOf(await lookup(`?id=${OTHER.id}`));
      expect(out).toHaveLength(1);
      expect(out[0].priceCents).toBe(otherBefore.priceCents);

      const zero = await itemsOf(await lookup(`?id=${PLAIN.id}`));
      expect(zero).toHaveLength(1);
      expect(zero[0]).toMatchObject({ priceCents: plainBefore.priceCents, stock: 0 });
    });

    it("400 bad_request for anything but exactly one well-formed question", async () => {
      const bad = [
        "",
        `?id=${PLAIN.id}&q=shampoo`,
        `?barcode=${EAN}&id=${PLAIN.id}`,
        "?q=a",
        "?q=%20%20",
        "?q=shampoo&limit=0",
        "?q=shampoo&limit=21",
        "?q=shampoo&limit=abc",
        "?q=shampoo&limit=1.5",
        "?barcode=",
        "?barcode=%00",
        "?id=",
        `?id=${PLAIN.id}&lang=de`,
        `?id=${PLAIN.id}&limit=3`,
      ];
      for (const qs of bad) {
        const res = await lookup(qs);
        expect(res.status, qs).toBe(400);
        expect(await res.json()).toEqual({ error: "bad_request" });
      }
    });
  });

  /* ---------- identify --------------------------------------------------- */

  describe("POST /api/partner/products/identify", () => {
    it("503 not_configured without the shop's OpenAI key — after the photo is checked", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await identify({ image: IMAGE });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("400 for anything but a JPEG, PNG or WebP data URL; 413 over 2 MB", async () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const bad: unknown[] = [
        "not json",
        null,
        [],
        {},
        { image: 5 },
        { image: "https://example.com/a.png" },
        { image: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
        { image: "data:image/png;base64," },
        { image: `data:image/jpeg;base64,${PNG_B64}` }, // says JPEG, is a PNG
        { image: IMAGE, lang: "de" },
      ];
      for (const body of bad) {
        const res = await identify(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(await res.json()).toEqual({ error: "bad_request" });
      }
      // 2 MB of bytes behind a real PNG header: decoded, it is over the cap
      const big = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(2 * 1024 * 1024)]);
      const res = await identify({ image: `data:image/png;base64,${big.toString("base64")}` });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "too_large" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      // …and a body far past it is refused before it is even parsed
      const huge = await identify(JSON.stringify({ image: "data:image/png;base64," + "A".repeat(3 * 1024 * 1024) }));
      expect(huge.status).toBe(413);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("asks the model once, and turns its numbers into products, best first", async () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const cands = identifyCandidates(await loadPartnerCatalog());
      const plainN = cands.findIndex((c) => c.productId === PLAIN.id) + 1;
      const sizedN = cands.findIndex((c) => c.productId === SIZED.id) + 1;
      const sizeN = cands[sizedN - 1].sizes.filter(Boolean).indexOf(SIZE) + 1;
      expect(plainN).toBeGreaterThan(0);

      const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ matches: [{ n: plainN, s: 0 }, { n: sizedN, s: sizeN }, { n: 99999, s: 1 }] }) } }],
        }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const res = await identify({ image: IMAGE });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const items = (await res.json()).items as Array<{ productId: string; variant: string; priceCents: number; purchaseCents: number | null }>;
      expect(items.map((p) => [p.productId, p.variant])).toEqual([
        [PLAIN.id, ""],
        [SIZED.id, SIZE],
      ]);
      expect(items[0].purchaseCents).toBeNull();
      expect(items[1].priceCents).toBe(Math.round(SIZE_PRICE * 100));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const sent = String(init.body);
      expect(sent).toContain("image_url");
      expect(sent).toContain(PNG_B64);
      expect(sent).toContain('"detail":"low"');
      // the model sees names, not money
      expect(sent).not.toContain("priceCents");
      expect(sent).not.toContain("purchase");
    });

    it("a reply with nothing usable is no match; an OpenAI outage is 502 upstream", async () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "{\"reply\":\"ok\"}" } }] })));
      const none = await identify({ image: IMAGE });
      expect(none.status).toBe(200);
      expect(await none.json()).toEqual({ items: [] });

      vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 503 })));
      const down = await identify({ image: IMAGE });
      expect(down.status).toBe(502);
      expect(await down.json()).toEqual({ error: "upstream" });
    });
  });

  /* ---------- the budget ------------------------------------------------- */

  describe("the budget (src/lib/partner-auth.ts)", () => {
    const expect429 = async (res: Response, maxWait: number) => {
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "rate_limited" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      const wait = Number(res.headers.get("retry-after"));
      expect(Number.isInteger(wait)).toBe(true);
      expect(wait).toBeGreaterThanOrEqual(1);
      expect(wait).toBeLessThanOrEqual(maxWait);
      return wait;
    };

    it("is 120 lookups a minute, then 429 with Retry-After until the minute is over", async () => {
      expect(PARTNER_LIMITS.lookup).toEqual([{ bucket: "partner-lookup-min", max: 120, windowMs: 60_000 }]);
      // a stranger without the secret spends none of it
      for (let i = 0; i < 150; i++) expect((await lookup("?q=a", {})).status).toBe(401);
      // every request past the secret counts, a refused question too (cheap: no database)
      for (let i = 0; i < 120; i++) expect((await lookup("?q=a")).status).toBe(400);
      await expect429(await lookup(`?id=${PLAIN.id}`), 60);
      await expect429(await lookup("?q=a"), 60);

      const later = Date.now() + 61_000;
      vi.spyOn(Date, "now").mockReturnValue(later);
      expect((await lookup("?q=a")).status).toBe(400);
    });

    it("is 20 photo matches a minute; refused photos are not counted", async () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const model = noMatchModel();
      vi.stubGlobal("fetch", model);
      // none of these reaches OpenAI, so none of them is counted
      for (let i = 0; i < 30; i++) expect((await identify({ image: "data:image/png;base64," })).status).toBe(400);
      const big = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
      expect((await identify({ image: `data:image/png;base64,${big}` })).status).toBe(413);
      delete process.env.OPENAI_API_KEY;
      expect((await identify({ image: IMAGE })).status).toBe(503);
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";

      for (let i = 0; i < 20; i++) expect((await identify({ image: IMAGE })).status).toBe(200);
      expect(model).toHaveBeenCalledTimes(20);
      await expect429(await identify({ image: IMAGE }), 60);
      expect(model).toHaveBeenCalledTimes(20);
      // a refused body is still a 400, budget or not: it would not have been sent
      expect((await identify({ image: "data:image/png;base64," })).status).toBe(400);
    });

    it("is 500 photo matches a day, however they are spread over the minutes", async () => {
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const start = now;
      for (let i = 0; i < 500; i++) {
        if (i > 0 && i % 20 === 0) now += 61_000; // a fresh minute every twenty
        expect(partnerOverBudget("identify"), `match ${i + 1}`).toBeNull();
      }
      now += 61_000;
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const model = noMatchModel();
      vi.stubGlobal("fetch", model);
      const wait = await expect429(await identify({ image: IMAGE }), 24 * 3600);
      expect(wait).toBeGreaterThan(60); // the day's wait, not the minute's
      expect(Math.abs(start + 24 * 3600 * 1000 - now - wait * 1000)).toBeLessThan(2000);
      expect(model).not.toHaveBeenCalled();

      now = start + 24 * 3600 * 1000 + 1000; // the next day
      expect((await identify({ image: IMAGE })).status).toBe(200);
      expect(model).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------- read-only -------------------------------------------------- */

  it("neither route changes a single row of the database", async () => {
    await move({ productId: PLAIN.id, delta: 4, reason: "goods_in" });
    await setLevel(SIZED.id, SIZE, { ean: EAN });
    await upsertOverride(OTHER.id, { hidden: true });
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '{"matches":[{"n":1,"s":0}]}' } }] })));

    const before = await snapshot();
    expect(Object.keys(before).length).toBeGreaterThan(10);
    const answers = [
      await lookup(`?id=${PLAIN.id}`),
      await lookup(`?id=${OTHER.id}`),
      await lookup(`?barcode=${EAN}`),
      await lookup(`?q=${encodeURIComponent(PLAIN.b.split(/\s+/)[0])}&lang=et`),
      await lookup("?q=a"),
      await identify({ image: IMAGE, lang: "en" }),
      await identify({ image: "data:image/png;base64," }),
    ];
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200, 400, 200, 400]);
    expect(await snapshot()).toEqual(before);

    // and the fingerprint does see a change: one shelf threshold moved
    await setLevel(PLAIN.id, "", { lowThreshold: 9 });
    expect(await snapshot()).not.toEqual(before);
  });
});
