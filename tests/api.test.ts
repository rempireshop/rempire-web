/** The routes themselves: same handlers Next calls, driven with plain Requests. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const ORIGIN = "https://rempireshop.com";
let ip = 0;

function post(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}`,
  };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
function put(path: string, body: unknown, cookie?: string) {
  const req = post(path, body, cookie);
  return new Request(req, { method: "PUT" });
}
function get(path: string, cookie?: string) {
  return new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
}

const goodOrder = {
  lang: "RU",
  items: [{ id: product.id, qty: 1 }],
  customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555 5555" },
  shipping: { method: "parcel", country: "EE", pointId: "1234", pointName: "Kristiine keskus" },
};

describe("api routes", () => {
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

  it("POST /api/orders creates an order and answers with its number", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(post("/api/orders/", goodOrder));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.number).toMatch(/^R-1\d{5}$/);
    expect(body.total).toBeGreaterThan(0);
    expect(body.orderId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("POST /api/orders ignores prices sent by the client", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const honest = await (await POST(post("/api/orders/", goodOrder))).json();
    const tampered = await (
      await POST(
        post("/api/orders/", {
          ...goodOrder,
          items: [{ id: product.id, qty: 1, price: 0.01 }],
          total: 0.01,
          subtotal: 0.01,
        }),
      )
    ).json();
    expect(tampered.total).toBe(honest.total);
  });

  it("POST /api/orders reports bad input by code", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const bad = await POST(post("/api/orders/", { ...goodOrder, items: [] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("empty_order");

    const noEmail = await POST(post("/api/orders/", { ...goodOrder, customer: { name: "X" } }));
    expect((await noEmail.json()).error).toBe("bad_email");
  });

  it("POST /api/orders is rate limited per IP", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const one = () =>
      POST(
        new Request(`${ORIGIN}/api/orders/`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.44" },
          body: JSON.stringify(goodOrder),
        }),
      );
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await one()).status);
    expect(codes.filter((c) => c === 201).length).toBe(10);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });

  it("GET /api/overrides is public, cached and carries the settings", async () => {
    const { GET } = await import("@/app/api/overrides/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.overrides).toEqual({});
    expect(body.settings.chatbot).toBe(true);
    expect(body.settings.flows).toBeTruthy();
    // the home banner: the key is always present, null = app.js's built-in slides
    expect("hero" in body.settings).toBe(true);
    expect(body.settings.hero).toBeNull();
  });

  /* The default the panel draws its three switches from has to be the default
     the sender reads. «Товар снова в наличии» used to come down true here
     while runBackInStock() read it as false: the switch said «включено» and
     no letter ever left, so the only way to turn the flow on was to switch it
     off and on again. */
  it("the flow defaults it publishes are the ones the sender reads", async () => {
    const { GET } = await import("@/app/api/overrides/route");
    const { FLOW_DEFAULTS } = await import("@/lib/flows");
    const body = await (await GET()).json();
    for (const key of ["abandoned", "birthday", "backstock"] as const) {
      expect(body.settings.flows[key], `flows.${key}`).toBe(FLOW_DEFAULTS[key]);
    }
    expect(body.settings.flows.backstock).toBe(false);
  });

  it("PUT /api/admin/settings stores the home banner and hands it back publicly", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");
    const hero = {
      slides: [{ id: "s1", eyebrow: {}, title: { RU: "Скидка на бороду" }, sub: {}, cta: { RU: "Смотреть" }, go: "cat:beard", image: product.id, on: true }],
      interval: 6000,
    };

    await PUT(put("/api/admin/settings/", { hero }, admin));
    const body = await (await publicGet()).json();
    expect(body.settings.hero).toEqual(hero);

    // «Сбросить к стандартному» stores a real null, not a missing key
    await PUT(put("/api/admin/settings/", { hero: null }, admin));
    const back = await (await publicGet()).json();
    expect(back.settings.hero).toBeNull();
  });

  /* Nothing capped this route's body, and a key outside the five validated
     ones is stored as raw jsonb AND written a second time into admin_audit —
     so one request could persist twice its own size for good. Same cap and
     the same code («too_large», 413) as the other admin writers. */
  it("PUT /api/admin/settings refuses a body far larger than the content document", async () => {
    const { PUT, GET } = await import("@/app/api/admin/settings/route");
    const res = await PUT(put("/api/admin/settings/", { note_to_self: "я".repeat(300_000) }, admin));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("too_large");
    // nothing was stored on the way out
    const back = await (await GET(get("/api/admin/settings/", admin))).json();
    expect(back.settings.note_to_self).toBeUndefined();

    // …and a normal-sized write still goes through
    const ok = await PUT(put("/api/admin/settings/", { note_to_self: "коротко" }, admin));
    expect(ok.status).toBe(200);
  });

  /* «Настройки → Доставка и оплата → Какие банки показывать»: the codes go
     through cleanBankFilter() on the way in, like pricing and gift_amounts —
     the first door, not the only one. */
  it("PUT /api/admin/settings cleans the bank list before storing it", async () => {
    const { PUT, GET } = await import("@/app/api/admin/settings/route");
    const res = await PUT(
      put("/api/admin/settings/", { payment_banks: ["lhvbee22", "LHVBEE22", "", 7, "a code"] }, admin),
    );
    expect(res.status).toBe(200);
    const back = await (await GET(get("/api/admin/settings/", admin))).json();
    expect(back.settings.payment_banks).toEqual(["LHVBEE22"]);

    // «показывать все» is an empty list, and it must survive the round trip
    await PUT(put("/api/admin/settings/", { payment_banks: [] }, admin));
    const all = await (await GET(get("/api/admin/settings/", admin))).json();
    expect(all.settings.payment_banks).toEqual([]);
  });

  it("PUT /api/admin/settings still refuses a body that is not a JSON object", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    for (const body of ["null", "5", "[]", '"x"', "не json"]) {
      const res = await PUT(new Request(`${ORIGIN}/api/admin/settings/`, {
        method: "PUT", headers: { "content-type": "application/json", cookie: admin }, body,
      }));
      expect(res.status, `body ${body}`).toBe(400);
      expect(["bad_body", "bad_json"]).toContain((await res.json()).error);
    }
  });

  it("admin routes refuse anonymous and forged callers", async () => {
    const overrides = await import("@/app/api/admin/overrides/route");
    const orders = await import("@/app/api/admin/orders/route");
    const audit = await import("@/app/api/admin/audit/route");

    for (const res of [
      await overrides.PUT(put("/api/admin/overrides/", { id: product.id, price: 1 })),
      await orders.GET(get("/api/admin/orders/")),
      await audit.GET(get("/api/admin/audit/")),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()).ok).toBe(false);
    }

    const forged = `${ADMIN_COOKIE}=v1.${Date.now() + 1000}.notasignature`;
    expect((await orders.GET(get("/api/admin/orders/", forged))).status).toBe(401);
  });

  it("PUT /api/admin/overrides saves, shows up publicly and lands in the audit", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");
    const { GET: auditGet } = await import("@/app/api/admin/audit/route");

    const res = await PUT(put("/api/admin/overrides/", { id: product.id, price: 4.2, stock: "low" }, admin));
    expect(res.status).toBe(200);

    const body = await (await publicGet()).json();
    expect(body.overrides[product.id]).toMatchObject({ price: 4.2, stock: "low" });

    // the override, not the catalogue, is what the next order pays
    const { POST } = await import("@/app/api/orders/route");
    const order = await (await POST(post("/api/orders/", goodOrder))).json();
    expect(order.total).toBeCloseTo(4.2 + 5.47, 2);

    const audit = await (await auditGet(get("/api/admin/audit/", admin))).json();
    expect(audit.audit.some((a: { action: string }) => a.action === "override.set")).toBe(true);
  });

  it("the salon (pro) price never reaches the public overrides feed", async () => {
    const { PUT, GET: adminGet } = await import("@/app/api/admin/overrides/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");

    const res = await PUT(put("/api/admin/overrides/", { id: product.id, price: 9, proPrice: 6.5 }, admin));
    expect(res.status).toBe(200);

    // the panel sees it …
    const mine = await (await adminGet(get("/api/admin/overrides/", admin))).json();
    expect(mine.overrides[product.id]).toMatchObject({ price: 9, proPrice: 6.5 });

    // … an anonymous shopper does not — commercial information stays server-side
    const pub = await (await publicGet()).json();
    expect(pub.overrides[product.id]).toMatchObject({ price: 9 });
    expect(pub.overrides[product.id]).not.toHaveProperty("proPrice");
    expect(JSON.stringify(pub)).not.toContain("proPrice");
    expect(JSON.stringify(pub.settings)).not.toContain("proDiscountPct");
  });

  it("PUT /api/admin/overrides rejects a nonsense stock state", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const res = await PUT(put("/api/admin/overrides/", { id: product.id, stock: "maybe" }, admin));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_stock");
  });

  it("PUT /api/admin/settings stores what the storefront reads back", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const { GET: publicGet } = await import("@/app/api/overrides/route");

    await PUT(put("/api/admin/settings/", { chatbot: false, flows: { abandoned: true } }, admin));
    const body = await (await publicGet()).json();
    expect(body.settings.chatbot).toBe(false);
    expect(body.settings.flows).toEqual({ abandoned: true });

    const bad = await PUT(put("/api/admin/settings/", { "not a key!": 1 }, admin));
    expect(bad.status).toBe(400);
  });

  it("GET/PATCH /api/admin/orders/<id> reads one order and moves its status", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const one = await import("@/app/api/admin/orders/[id]/route");
    const list = await import("@/app/api/admin/orders/route");

    const created = await (await POST(post("/api/orders/", goodOrder))).json();
    const ctx = { params: Promise.resolve({ id: created.orderId }) };

    const read = await (await one.GET(get(`/api/admin/orders/${created.orderId}/`, admin), ctx)).json();
    expect(read.order.number).toBe(created.number);
    expect(read.order.items[0].id).toBe(product.id);

    const patched = await one.PATCH(
      put(`/api/admin/orders/${created.orderId}/`, { status: "paid", note: "оплачено вручную" }, admin),
      { params: Promise.resolve({ id: created.orderId }) },
    );
    const after = await patched.json();
    expect(after.order.status).toBe("paid");
    expect(after.order.notes).toBe("оплачено вручную");

    // by number as well as by uuid
    const byNumber = await one.GET(get(`/api/admin/orders/${created.number}/`, admin), {
      params: Promise.resolve({ id: created.number }),
    });
    expect((await byNumber.json()).order.id).toBe(created.orderId);

    const filtered = await (await list.GET(get("/api/admin/orders/?status=paid", admin))).json();
    expect(filtered.orders.length).toBe(1);
    expect((await (await list.GET(get("/api/admin/orders/?status=new", admin))).json()).orders.length).toBe(0);

    const missing = await one.GET(get("/api/admin/orders/R-999999/", admin), {
      params: Promise.resolve({ id: "R-999999" }),
    });
    expect(missing.status).toBe(404);
  });

  /* The journal's «Вернуть» after «Отменить заказ» (and after «возврат») is
     PATCH {status:"paid"} on an order whose money already arrived. That used
     to fall into the mark-paid-by-hand branch: applyPaymentResult() saw the
     order as already paid, rewrote the payment record as a "manual" one and
     changed nothing else — the card said the cancellation was undone, the
     order stayed cancelled. A settled order stepping back to paid is a status
     move and nothing more. */
  it("PATCH status=paid on a cancelled or refunded order is the step back, not a second payment", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const one = await import("@/app/api/admin/orders/[id]/route");
    for (const away of ["cancelled", "refunded"] as const) {
      const created = await (await POST(post("/api/orders/", goodOrder))).json();
      const ctx = () => ({ params: Promise.resolve({ id: created.orderId }) });
      const patch = (body: unknown) => one.PATCH(put(`/api/admin/orders/${created.orderId}/`, body, admin), ctx());

      // the money arrives (by hand here — the same door a provider's ticket uses)
      const paid = await (await patch({ status: "paid" })).json();
      expect(paid.order.status).toBe("paid");
      expect(paid.order.payment.status).toBe("paid");
      const settledAt = paid.order.payment.at;

      await patch({ status: away });
      const undone = await (await patch({ status: "paid" })).json();
      expect(undone.ok).toBe(true);
      expect(undone.order.status, `undo of «${away}» did not put the status back`).toBe("paid");
      // the payment record is the one the money arrived with, not a fresh "manual" one
      expect(undone.order.payment.at).toBe(settledAt);

      // and a second «оплачен» on an order that is paid already changes nothing
      const again = await (await patch({ status: "paid" })).json();
      expect(again.order.status).toBe("paid");
      expect(again.order.payment.at).toBe(settledAt);
    }
  });
});
