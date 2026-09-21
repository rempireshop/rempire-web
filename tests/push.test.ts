/**
 * Web Push — «уведомления о заказе на телефон».
 *
 * Renat, 20.09.2026, through Dim: «Notifications about order on the phone,
 * through app would be nice — apple and android.» What that turned into:
 * db/migrations/200_push_subscriptions.sql, src/lib/push.ts,
 * src/app/api/admin/push/**, and public/shop2/admin-sw.js on the phone.
 * This file holds the five promises the rest of the shop is allowed to make
 * about it, and each of them is a way it could go wrong quietly.
 *
 *   1. NO VAPID KEYS IS A NORMAL STATE, not an error. Every fresh deployment,
 *      every test run and the shop right now are in it. sendPush() must answer
 *      «not configured» without sending, without throwing and without so much
 *      as a database query — the same bargain src/lib/notify.ts makes for
 *      Telegram, and for the same reason: the order is the contract, not the
 *      ping. A throw here reaches a payment callback.
 *
 *   2. A 410 RETIRES THAT SUBSCRIPTION, AND ONLY THAT ONE. A push service
 *      answers 404/410 for a device that is gone for good. Retried for ever it
 *      would cost a request per order per dead phone, for the life of the
 *      shop; retired on the wrong signal it would silently disconnect Renat's
 *      phone the afternoon Apple has a bad hour. So: 410 retires, 500 does
 *      not, and neither touches the devices beside it.
 *
 *   3. SEVERAL DEVICES FOR ONE ADMIN ALL GET IT. There is one administrator in
 *      this shop (src/lib/auth.ts — one password, no user table) and three
 *      devices: the iPhone, the Android, the Mac on the counter. A design that
 *      quietly assumed one subscription per person would have looked perfect
 *      in a test with one row.
 *
 *   4. A PAID ORDER SENDS EXACTLY ONE PUSH PER SUBSCRIPTION — not two to one
 *      phone, not one to the first of three — and a push that cannot be sent
 *      does not fail the order.
 *
 *   5. THE ROUTES REFUSE WITHOUT AN ADMIN SESSION. The subscribe route decides
 *      which devices the shop's orders are read on; the list route hands out
 *      those endpoints. Both are admin-only for the same reason the order list
 *      is.
 *
 * The push service itself is a stub — `web-push` is mocked below so the suite
 * can answer 201, 410 or 500 for a named endpoint. Everything under it is
 * real: a real PGlite, the real migration, the real routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { onOrderPaid } from "@/lib/mail-hooks";
import {
  cleanSubscription,
  listSubscriptions,
  pushConfigured,
  pushPublicKey,
  removeSubscription,
  saveSubscription,
  sendPush,
} from "@/lib/push";
import type { OrderLike } from "@/emails/types";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* ---------- the push service, stubbed ------------------------------------ */

const wp = vi.hoisted(() => ({
  /** Every call the library was asked to make, in order. */
  sent: [] as Array<{ endpoint: string; payload: string; ttl: unknown; urgency: unknown }>,
  /** endpoint → the status to answer with. 201 for anything unlisted. */
  status: new Map<string, number>(),
}));

vi.mock("web-push", () => {
  /* The library's own error. `statusCode` is the only field anything reads —
     it is what separates «this device is gone» from «not right now»
     (src/lib/push.ts isGone). */
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  const sendNotification = async (
    sub: { endpoint: string },
    payload: string,
    options: { TTL?: number; urgency?: string },
  ) => {
    wp.sent.push({ endpoint: sub.endpoint, payload, ttl: options?.TTL, urgency: options?.urgency });
    const code = wp.status.get(sub.endpoint) ?? 201;
    if (code >= 300) throw new WebPushError(`stub said ${code}`, code);
    return { statusCode: code, body: "", headers: {} };
  };
  /* Both shapes on purpose: the real package is CommonJS and arrives under
     `default`, a bundler hands back the named export, and loadWebPush() has to
     work with either. A stub that offered only one would let that helper rot. */
  return { default: { sendNotification, WebPushError }, sendNotification, WebPushError };
});

/* ---------- fixtures ----------------------------------------------------- */

const PUB = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const PRIV = "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
const P256DH = PUB;
const AUTH = "tBHItJI5svbpez7KI4CCXg";

/** His three devices, at three different push services. */
const IPHONE = "https://web.push.apple.com/rmp/iphone";
const ANDROID = "https://fcm.googleapis.com/fcm/send/android";
const MAC = "https://web.push.apple.com/rmp/mac";

const ORDER: OrderLike = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  number: "R-100042",
  lang: "RU",
  email: "klient@example.com",
  name: "Мария Тамм",
  items: [
    { id: "p1", title: "Fresh.Hair", brand: "Kevin.Murphy", qty: 2, price: 27, sum: 54 },
    { id: "p2", title: "Powder.Puff", brand: "Kevin.Murphy", qty: 1, price: 24, sum: 24 },
  ],
  shipping: { method: "parcel", carrier: "omniva", pointName: "Kristiine keskus" },
  shippingPrice: 3.5,
  total: 81.5,
};

const BASE = "https://test.rempireshop.com";
let admin = "";

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { cookie: admin, "content-type": "application/json", "x-forwarded-for": "203.0.113.41", ...(init.headers ?? {}) },
  });
}

/** The same request with no cookie at all — the signed-out browser. */
function anon(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.42", ...(init.headers ?? {}) },
  });
}

async function subscribe(endpoint: string, label = "") {
  return saveSubscription({ endpoint, p256dh: P256DH, auth: AUTH, label });
}

function keysOn() {
  process.env.VAPID_PUBLIC_KEY = PUB;
  process.env.VAPID_PRIVATE_KEY = PRIV;
}

function keysOff() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}

/** The last payload the stub was handed, parsed. */
function payloadOf(i = 0) {
  return JSON.parse(wp.sent[i].payload) as { title: string; body: string; url: string; tag: string };
}

/**
 * A shop whose letters go out, with nothing leaving the machine.
 *
 * `MailHookResult.ok` is decided by the CUSTOMER's «Заказ принят» — so
 * proving «a broken push does not fail the order» needs an order that was
 * succeeding to begin with. Without RESEND_API_KEY the hook already answers
 * ok:false for its own reasons and the push would be invisible in it.
 *
 * RESEND_TO is deliberately left unset, so the owner's e-mail ping stays off
 * and `notified` can only be true because of the push.
 */
function stubNetwork(): () => void {
  const saved = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } })),
  );
  return () => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  };
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  keysOff();
  await teardownDb();
});

beforeEach(async () => {
  wp.sent.length = 0;
  wp.status.clear();
  resetRateLimits();
  keysOn();
  await exec("truncate push_subscriptions");
});

/* ---------- 1. no keys --------------------------------------------------- */

describe("a shop with no VAPID keys", () => {
  it("says so, and hands the panel an empty key rather than the word null", () => {
    keysOff();
    expect(pushConfigured()).toBe(false);
    expect(pushPublicKey()).toBe("");
    keysOn();
    expect(pushConfigured()).toBe(true);
    expect(pushPublicKey()).toBe(PUB);
  });

  it("sends nothing, throws nothing, and does not even look at the table", async () => {
    await subscribe(IPHONE, "iPhone");
    keysOff();

    const res = await sendPush({ title: "t", body: "b" });

    expect(res).toEqual({ ok: false, configured: false, devices: 0, sent: 0, failed: 0, gone: 0 });
    expect(wp.sent).toEqual([]);
    /* `devices: 0` with a live row in the table is the proof that the keys are
       checked BEFORE the query — a paid order must not pay for a round trip to
       a channel that is switched off. */
    expect(await listSubscriptions()).toHaveLength(1);
  });

  it("does not fail a paid order", async () => {
    await subscribe(IPHONE, "iPhone");
    keysOff();
    const restore = stubNetwork();

    const res = await onOrderPaid(ORDER);

    expect(res.ok).toBe(true);
    expect(res.reason).not.toBe("exception");
    expect(wp.sent).toEqual([]);
    restore();
  });

  it("refuses to register a device at all, instead of accepting one it can never reach", async () => {
    keysOff();
    const route = await import("@/app/api/admin/push/subscribe/route");
    const res = await route.POST(
      req("/api/admin/push/subscribe/", {
        method: "POST",
        body: JSON.stringify({ endpoint: IPHONE, keys: { p256dh: P256DH, auth: AUTH }, label: "iPhone" }),
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
    /* Nothing written: «включено» over a shop that cannot send is the
       RESEND_TO mistake again (src/lib/notify.ts). */
    expect(await listSubscriptions()).toEqual([]);
  });

  it("still lets him turn a device OFF", async () => {
    await subscribe(IPHONE, "iPhone");
    keysOff();
    const route = await import("@/app/api/admin/push/unsubscribe/route");
    const res = await route.POST(
      req("/api/admin/push/unsubscribe/", { method: "POST", body: JSON.stringify({ endpoint: IPHONE }) }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect(await listSubscriptions()).toEqual([]);
  });
});

/* ---------- 2. what a 410 means ------------------------------------------ */

describe("a subscription the push service says is gone", () => {
  it("is retired on a 410, and the devices beside it are untouched", async () => {
    await subscribe(IPHONE, "iPhone");
    await subscribe(ANDROID, "Samsung");
    await subscribe(MAC, "Mac");
    wp.status.set(ANDROID, 410);

    const res = await sendPush({ title: "t", body: "b" });

    expect(res).toMatchObject({ ok: true, configured: true, devices: 3, sent: 2, failed: 0, gone: 1 });
    expect((await listSubscriptions()).map((d) => d.endpoint).sort()).toEqual([IPHONE, MAC].sort());

    const [row] = await query<{ retired_reason: string; retired_at: string }>(
      "select retired_reason, retired_at from push_subscriptions where endpoint = $1",
      [ANDROID],
    );
    expect(row.retired_reason).toBe("gone");
    expect(row.retired_at).toBeTruthy();
  });

  it("is never sent to again", async () => {
    await subscribe(IPHONE, "iPhone");
    await subscribe(ANDROID, "Samsung");
    wp.status.set(ANDROID, 410);
    await sendPush({ title: "one", body: "b" });

    wp.sent.length = 0;
    const second = await sendPush({ title: "two", body: "b" });

    expect(second).toMatchObject({ devices: 1, sent: 1, gone: 0 });
    expect(wp.sent.map((s) => s.endpoint)).toEqual([IPHONE]);
  });

  it("is retired on a 404 too — the other way a push service says «never again»", async () => {
    await subscribe(IPHONE, "iPhone");
    wp.status.set(IPHONE, 404);

    expect(await sendPush({ title: "t", body: "b" })).toMatchObject({ ok: false, gone: 1, sent: 0 });
    expect(await listSubscriptions()).toEqual([]);
  });

  it("but a 500 is about today, not about the device: kept, and tried again", async () => {
    await subscribe(IPHONE, "iPhone");
    await subscribe(ANDROID, "Samsung");
    wp.status.set(ANDROID, 500);

    const res = await sendPush({ title: "t", body: "b" });

    expect(res).toMatchObject({ ok: true, devices: 2, sent: 1, failed: 1, gone: 0 });
    expect((await listSubscriptions()).map((d) => d.endpoint).sort()).toEqual([ANDROID, IPHONE].sort());

    wp.status.clear();
    wp.sent.length = 0;
    expect(await sendPush({ title: "t", body: "b" })).toMatchObject({ devices: 2, sent: 2, failed: 0 });
  });
});

/* ---------- 3. one admin, several devices -------------------------------- */

describe("one administrator, several phones", () => {
  it("sends to every one of them, once each, with the same message", async () => {
    await subscribe(IPHONE, "iPhone Renat");
    await subscribe(ANDROID, "Samsung");
    await subscribe(MAC, "Mac на стойке");

    const res = await sendPush({ title: "💶 Оплачен заказ R-100042", body: "81,50 € · Мария Тамм", url: "/shop2/admin/?order=R-100042", tag: "order:1" });

    expect(res).toMatchObject({ ok: true, devices: 3, sent: 3, failed: 0, gone: 0 });
    expect(wp.sent.map((s) => s.endpoint).sort()).toEqual([ANDROID, IPHONE, MAC].sort());
    expect(new Set(wp.sent.map((s) => s.payload)).size).toBe(1);

    const payload = payloadOf();
    expect(payload).toEqual({
      title: "💶 Оплачен заказ R-100042",
      body: "81,50 € · Мария Тамм",
      url: "/shop2/admin/?order=R-100042",
      tag: "order:1",
    });
    /* The two options the worker cannot set for itself. A day, not the
       library's four weeks; high, because it is a paid order. */
    expect(wp.sent[0].ttl).toBe(24 * 60 * 60);
    expect(wp.sent[0].urgency).toBe("high");
  });

  it("marks only the devices that took it", async () => {
    await subscribe(IPHONE, "iPhone");
    await subscribe(ANDROID, "Samsung");
    wp.status.set(ANDROID, 500);

    await sendPush({ title: "t", body: "b" });

    const devices = await listSubscriptions();
    expect(devices.find((d) => d.endpoint === IPHONE)!.lastOkAt).toBeTruthy();
    expect(devices.find((d) => d.endpoint === ANDROID)!.lastOkAt).toBeNull();
  });

  it("keeps one row per device however many times the panel re-subscribes", async () => {
    await subscribe(IPHONE, "iPhone Renat");
    await subscribe(IPHONE);
    await subscribe(IPHONE);

    const devices = await listSubscriptions();
    expect(devices).toHaveLength(1);
    /* A silent boot-time re-subscribe sends no label and must not wipe the one
       he typed — it is the only thing telling two 300-character URLs apart. */
    expect(devices[0].label).toBe("iPhone Renat");
  });

  it("brings a retired device back as itself when he turns it on again", async () => {
    const first = await subscribe(IPHONE, "iPhone Renat");
    await removeSubscription(IPHONE, "owner");
    expect(await listSubscriptions()).toEqual([]);

    const again = await subscribe(IPHONE);

    expect(await listSubscriptions()).toHaveLength(1);
    expect(again.label).toBe("iPhone Renat");
    /* Not a new device: `created_at` is when this phone was first trusted with
       the shop's orders, and that is a fact about the past. */
    expect(again.createdAt).toBe(first.createdAt);
  });

  it("refuses a body that is not a subscription before it can become a permanent row", () => {
    expect(cleanSubscription(null)).toBeNull();
    expect(cleanSubscription("nope")).toBeNull();
    expect(cleanSubscription({ endpoint: IPHONE })).toBeNull();
    expect(cleanSubscription({ endpoint: "http://insecure.example/x", keys: { p256dh: P256DH, auth: AUTH } })).toBeNull();
    expect(cleanSubscription({ endpoint: "not a url", keys: { p256dh: P256DH, auth: AUTH } })).toBeNull();
    /* The flat shape is taken as well as the browser's nested one — a panel
       that assembles the body by hand invariably flattens it. */
    expect(cleanSubscription({ endpoint: IPHONE, p256dh: P256DH, auth: AUTH }, "iPhone")).toEqual({
      endpoint: IPHONE,
      p256dh: P256DH,
      auth: AUTH,
      label: "iPhone",
    });
  });
});

/* ---------- 4. the paid order -------------------------------------------- */

describe("a paid order", () => {
  it("sends exactly one push per subscription, carrying the order", async () => {
    await subscribe(IPHONE, "iPhone");
    await subscribe(ANDROID, "Samsung");
    await subscribe(MAC, "Mac");
    const restore = stubNetwork();

    const res = await onOrderPaid(ORDER);

    expect(wp.sent).toHaveLength(3);
    expect(wp.sent.map((s) => s.endpoint).sort()).toEqual([ANDROID, IPHONE, MAC].sort());

    const payload = payloadOf();
    expect(payload.title).toContain("R-100042");
    expect(payload.body).toContain("81,50 €");
    expect(payload.body).toContain("Мария Тамм");
    /* Two items: the first is named and the rest are counted. */
    expect(payload.body).toContain("+1");
    /* A path, never an absolute URL — the worker resolves it against its own
       origin, so the stand's notification opens the stand's panel. */
    expect(payload.url).toBe(`/shop2/admin/?order=${encodeURIComponent("R-100042")}`);
    expect(payload.tag).toBe(`order:${ORDER.id}`);

    /* No Telegram token and no RESEND_TO here, so `notified` can only be true
       because a phone took it — which is what it now means. */
    expect(res.notified).toBe(true);
    restore();
  });

  it("is not failed by a push service that is down", async () => {
    await subscribe(IPHONE, "iPhone");
    wp.status.set(IPHONE, 500);
    const restore = stubNetwork();

    const res = await onOrderPaid(ORDER);

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(true); // the customer's letter still went
    expect(res.reason).not.toBe("exception");
    expect(wp.sent).toHaveLength(1);
    expect(await listSubscriptions()).toHaveLength(1);
    restore();
  });

  it("sends nothing at all when no device is registered", async () => {
    const restore = stubNetwork();

    const res = await onOrderPaid(ORDER);

    expect(res.ok).toBe(true);
    expect(wp.sent).toEqual([]);
    restore();
  });
});

/* ---------- 5. the lock -------------------------------------------------- */

describe("the routes", () => {
  it("refuse every verb without an admin session", async () => {
    const list = await import("@/app/api/admin/push/route");
    const sub = await import("@/app/api/admin/push/subscribe/route");
    const unsub = await import("@/app/api/admin/push/unsubscribe/route");
    const test = await import("@/app/api/admin/push/test/route");

    const answers = await Promise.all([
      list.GET(anon("/api/admin/push/")),
      sub.POST(anon("/api/admin/push/subscribe/", { method: "POST", body: JSON.stringify({ endpoint: IPHONE, keys: { p256dh: P256DH, auth: AUTH } }) })),
      unsub.POST(anon("/api/admin/push/unsubscribe/", { method: "POST", body: JSON.stringify({ endpoint: IPHONE }) })),
      test.POST(anon("/api/admin/push/test/", { method: "POST", body: "{}" })),
    ]);

    for (const res of answers) {
      expect(res.status).toBe(401);
      expect((await res.json()).ok).toBe(false);
    }
    /* …and the refusal really was a refusal: nothing was written and nothing
       was sent on the way past the guard. */
    expect(await listSubscriptions()).toEqual([]);
    expect(wp.sent).toEqual([]);
  });

  it("refuse a tampered cookie the same way", async () => {
    const list = await import("@/app/api/admin/push/route");
    const res = await list.GET(
      new Request(`${BASE}/api/admin/push/`, { headers: { cookie: `${ADMIN_COOKIE}=v1.99999999999999.deadbeef` } }),
    );
    expect(res.status).toBe(401);
  });

  it("hand the panel the key, the flag and the devices", async () => {
    await subscribe(IPHONE, "iPhone Renat");
    const list = await import("@/app/api/admin/push/route");
    const res = await list.GET(req("/api/admin/push/"));
    const body = (await res.json()) as { ok: boolean; configured: boolean; publicKey: string; devices: Array<{ endpoint: string; label: string }> };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, configured: true, publicKey: PUB });
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({ endpoint: IPHONE, label: "iPhone Renat" });
    /* The private key is the one thing that must never leave the server. */
    expect(JSON.stringify(body)).not.toContain(PRIV);
  });

  it("register a device and then send it the owner's own test", async () => {
    const sub = await import("@/app/api/admin/push/subscribe/route");
    const saved = await sub.POST(
      req("/api/admin/push/subscribe/", {
        method: "POST",
        body: JSON.stringify({ endpoint: IPHONE, keys: { p256dh: P256DH, auth: AUTH }, label: "iPhone Renat" }),
      }),
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).device).toMatchObject({ endpoint: IPHONE, label: "iPhone Renat" });

    const test = await import("@/app/api/admin/push/test/route");
    const res = await test.POST(req("/api/admin/push/test/", { method: "POST", body: "{}" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, configured: true, devices: 1, sent: 1 });
    expect(wp.sent).toHaveLength(1);
    expect(payloadOf().tag).toBe("rempire-test");
  });

  it("say «no devices» rather than «sent» when the list is empty", async () => {
    const test = await import("@/app/api/admin/push/test/route");
    const res = await test.POST(req("/api/admin/push/test/", { method: "POST", body: "{}" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_devices");
    expect(wp.sent).toEqual([]);
  });

  it("refuse a body that is not JSON, and one that is not an object", async () => {
    const sub = await import("@/app/api/admin/push/subscribe/route");
    const bad = await sub.POST(req("/api/admin/push/subscribe/", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("bad_json");

    /* `null` is valid JSON and `typeof null === "object"` — the two-byte body
       that used to be a 500. */
    const nul = await sub.POST(req("/api/admin/push/subscribe/", { method: "POST", body: "null" }));
    expect(nul.status).toBe(400);
    expect((await nul.json()).error).toBe("bad_body");

    const shape = await sub.POST(req("/api/admin/push/subscribe/", { method: "POST", body: JSON.stringify({ endpoint: IPHONE }) }));
    expect(shape.status).toBe(400);
    expect((await shape.json()).error).toBe("bad_subscription");
  });

  it("answer «already off» instead of an error for a device that is not on", async () => {
    const unsub = await import("@/app/api/admin/push/unsubscribe/route");
    const res = await unsub.POST(req("/api/admin/push/unsubscribe/", { method: "POST", body: JSON.stringify({ endpoint: MAC }) }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: false });
  });
});
