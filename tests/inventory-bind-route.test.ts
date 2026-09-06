/**
 * The scanner's two routes as the panel calls them — binding a barcode
 * (PUT /api/admin/inventory/) and looking one up (GET /api/admin/inventory/
 * lookup/). src/lib/inventory.ts's own rules are pinned in inventory.test.ts;
 * this is the HTTP contract the scanner, the «Склад» form and the editor rely
 * on: the status codes, the error words, and what a refusal carries so the
 * owner can be told WHICH bottle already owns the code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
const sized = CATALOGUE.find((p) => VARIANTS[p.id] && VARIANTS[p.id].sizes.length > 1)!;
const plain = CATALOGUE.find((p) => !VARIANTS[p.id])!;
const SIZE_A = VARIANTS[sized.id].sizes[0];
const SIZE_B = VARIANTS[sized.id].sizes[1];

const ORIGIN = "https://rempireshop.com";
function put(body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/inventory/`, { method: "PUT", headers, body: JSON.stringify(body) });
}
function lookup(ean: string, cookie?: string) {
  return new Request(`${ORIGIN}/api/admin/inventory/lookup/?ean=${encodeURIComponent(ean)}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("PUT /api/admin/inventory + GET lookup — binding a barcode", () => {
  let admin = "";
  let PUT: (req: Request) => Promise<Response>;
  let GET: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
    ({ PUT } = await import("@/app/api/admin/inventory/route"));
    ({ GET } = await import("@/app/api/admin/inventory/lookup/route"));
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  it("401s without the admin cookie — both doors", async () => {
    expect((await PUT(put({ productId: plain.id, ean: "4006381333931" }))).status).toBe(401);
    expect((await GET(lookup("4006381333931"))).status).toBe(401);
  });

  it("binds a code to a product and size, and the lookup finds that bottle from then on", async () => {
    const res = await PUT(put({ productId: sized.id, variant: SIZE_A, ean: " 4006381333931 " }, admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.level).toMatchObject({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" });

    const hit = (await (await GET(lookup("4006381333931", admin))).json()).hit;
    expect(hit).toMatchObject({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" });
    expect(hit.product).toMatchObject({ id: sized.id, brand: sized.b, name: sized.n });
    // binding never counts stock: no ledger row, qty stays 0
    expect(hit.qty).toBe(0);
  });

  it("a code nobody bound answers hit: null, still 200 — that is the «К какому товару?» card", async () => {
    const res = await GET(lookup("29000000000019", admin));
    expect(res.status).toBe(200);
    expect((await res.json()).hit).toBeNull();
  });

  it("refuses the same code on another product, naming the product and size that own it", async () => {
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" }, admin));
    const res = await PUT(put({ productId: plain.id, ean: "4006381333931" }, admin));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("ean_taken");
    expect(body.detail).toBe(sized.id);
    // the panel's toast names the bottle — the id alone cannot say «40 мл»
    expect(body.takenBy).toEqual({ productId: sized.id, variant: SIZE_A });
    // …and the first binding is untouched
    expect((await (await GET(lookup("4006381333931", admin))).json()).hit.productId).toBe(sized.id);
  });

  it("refuses the same code on another size of the same product", async () => {
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" }, admin));
    const res = await PUT(put({ productId: sized.id, variant: SIZE_B, ean: "4006381333931" }, admin));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("ean_taken");
    expect(body.takenBy).toEqual({ productId: sized.id, variant: SIZE_A });
  });

  it("re-binding the same code to the same bottle is a no-op, not a conflict", async () => {
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" }, admin));
    const res = await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" }, admin));
    expect(res.status).toBe(200);
  });

  it("ean: null takes the code off — the lookup answers null again, the row keeps its threshold", async () => {
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931", lowThreshold: 4 }, admin));
    const res = await PUT(put({ productId: sized.id, variant: SIZE_A, ean: null }, admin));
    expect(res.status).toBe(200);
    const level = (await res.json()).level;
    expect(level.ean).toBeNull();
    expect(level.lowThreshold).toBe(4);
    expect((await (await GET(lookup("4006381333931", admin))).json()).hit).toBeNull();
    // and the freed code can go to another product now
    expect((await PUT(put({ productId: plain.id, ean: "4006381333931" }, admin))).status).toBe(200);
  });

  it("a second code on a size REPLACES the first — the panel asks before doing this", async () => {
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931" }, admin));
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333948" }, admin));
    expect((await (await GET(lookup("4006381333931", admin))).json()).hit).toBeNull();
    expect((await (await GET(lookup("4006381333948", admin))).json()).hit.variant).toBe(SIZE_A);
  });

  it("refuses what is not a barcode, in words the panel can show", async () => {
    for (const bad of ["abc", "1", "12345678901234567890"]) {
      const res = await PUT(put({ productId: plain.id, ean: bad }, admin));
      expect(res.status, `ean "${bad}"`).toBe(400);
      expect((await res.json()).error).toBe("bad_ean");
    }
    expect((await GET(lookup("   ", admin))).status).toBe(400);
  });

  /* «Порог «мало»» in the «Склад» row form. The panel checks the box itself
     now (stockCommit), but it used to send Number("abc") — NaN, which
     JSON.stringify writes as `null` — so what the route does with rubbish is
     the rule that decides whether a typo can quietly clear a warning level. */
  it("refuses a threshold that is not a whole number, and keeps the one already stored", async () => {
    await PUT(put({ productId: plain.id, ean: null, lowThreshold: 4 }, admin));
    for (const bad of [null, "abc", -1, 100001]) {
      const res = await PUT(put({ productId: plain.id, lowThreshold: bad }, admin));
      expect(res.status, `lowThreshold ${JSON.stringify(bad)}`).toBe(400);
      expect((await res.json()).error).toBe("bad_threshold");
    }
    const kept = await PUT(put({ productId: plain.id, lowThreshold: 4 }, admin));
    expect((await kept.json()).level.lowThreshold).toBe(4);
  });

  /* What the scanner's card and «Склад»'s red number are drawn from. The
     panel used to colour a row at a flat «3 or fewer» of its own; both now
     read `state`, so the route has to derive it from the row's OWN
     threshold. */
  it("the lookup carries the state the panel colours by, against the row's own threshold", async () => {
    const { move } = await import("@/lib/inventory");
    await PUT(put({ productId: sized.id, variant: SIZE_A, ean: "4006381333931", lowThreshold: 5 }, admin));
    await move({ productId: sized.id, variant: SIZE_A, delta: 4, reason: "goods_in" });

    let hit = (await (await GET(lookup("4006381333931", admin))).json()).hit;
    expect(hit.qty).toBe(4);
    // four left against a threshold of five is «мало», not «in» — a flat
    // three would have called this row fine
    expect(hit.state).toBe("low");

    await PUT(put({ productId: sized.id, variant: SIZE_A, lowThreshold: 2 }, admin));
    hit = (await (await GET(lookup("4006381333931", admin))).json()).hit;
    expect(hit.state).toBe("in");

    await move({ productId: sized.id, variant: SIZE_A, delta: -4, reason: "sale_pos" });
    hit = (await (await GET(lookup("4006381333931", admin))).json()).hit;
    expect(hit.qty).toBe(0);
    expect(hit.state).toBe("out");
  });
});
