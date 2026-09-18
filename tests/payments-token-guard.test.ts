/**
 * The two documented token checks, and what happens when one of them fails —
 * Dim's decision of 18.09.2026.
 *
 * Montonio's orders guide validates a returned order token with three
 * comparisons: `paymentStatus`, `uuid` against the order we started, and
 * `accessKey` against ours. This shop did one and a half: `accessKey` was
 * compared only when the claim was present, so a signed token carrying none at
 * all passed, and `uuid` was never compared with anything.
 *
 * Both are tightened here. What they do NOT do is refuse: a mismatch asks
 * Montonio — `GET /orders/:orderUuid`, which did not exist when the audit
 * wrote its recommendation — and the answer decides. Refusing on the spot is
 * how a customer who really paid ends up being told they have not.
 *
 * Real Postgres (PGlite), so the journal rows are the real ones. The provider
 * is a stand-in with a scripted `fetchOrder`, because the one thing that
 * cannot be run anywhere is Montonio itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { createOrder, getOrder, setOrderPayment, type Order } from "@/lib/orders";
import { signHs256 } from "@/lib/payments/jwt";
import type { MontonioOrderSnapshot } from "@/lib/payments/montonio";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { guardTokenChecks, canAskProvider } from "@/lib/payments/token-guard";
import type { PaymentProvider, VerifyResult } from "@/lib/payments/types";
import { makeRequest, PRODUCT, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

let restoreEnv: () => void = () => {};

const OURS = "montonio-uuid-ours";
const THEIRS = "montonio-uuid-somebody-elses";

/** A stand-in Montonio: everything unused throws, `fetchOrder` is scripted. */
function asker(answer: MontonioOrderSnapshot | null) {
  const fetchOrder = vi.fn(async (_uuid: string) => answer);
  const provider = {
    name: "montonio",
    createPayment: async () => {
      throw new Error("not used");
    },
    verifyReturn: async () => {
      throw new Error("not used");
    },
    verifyNotification: async () => {
      throw new Error("not used");
    },
    fetchOrder,
  } as unknown as PaymentProvider;
  return { provider, fetchOrder };
}

/** A provider that cannot be asked at all — the mock bank has no fetchOrder. */
const mute = {
  name: "mock",
  createPayment: async () => {
    throw new Error("not used");
  },
  verifyReturn: async () => {
    throw new Error("not used");
  },
  verifyNotification: async () => {
    throw new Error("not used");
  },
} as unknown as PaymentProvider;

function snapshot(over: Partial<MontonioOrderSnapshot> = {}): MontonioOrderSnapshot {
  return {
    uuid: OURS,
    paymentStatus: "PAID",
    grandTotal: 99.99,
    currency: "EUR",
    availableForRefund: 0,
    refunds: [],
    ...over,
  };
}

function ticket(order: Order, over: Partial<VerifyResult> = {}): VerifyResult {
  return {
    orderRef: order.number,
    status: "paid",
    providerRef: OURS,
    amount: Number(order.total),
    currency: "EUR",
    tokenChecks: { accessKey: "ok" },
    ...over,
  };
}

async function place(): Promise<Order> {
  const order = (await createOrder({
    lang: "RU",
    items: [{ id: PRODUCT.id, qty: 1 }],
    customer: { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" },
    shipping: { method: "pickup", country: "EE" },
  })) as unknown as Order;
  // what POST /api/payments/create/ records once Montonio has answered
  await setOrderPayment(order.id, { ref: OURS, status: "pending" });
  return (await getOrder(order.id))!;
}

async function mismatchRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await query<{ payload: Record<string, unknown> }>(
    "select payload from admin_audit where action = 'order.token_mismatch' order by id",
  );
  return rows.map((r) => r.payload);
}

describe("the documented token checks", () => {
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    process.env.E2E_BOOTSTRAP = "1";
    await setupDb();
  });
  afterAll(async () => {
    restoreEnv();
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it("lets a token through untouched when both checks pass", async () => {
    const order = await place();
    const { provider, fetchOrder } = asker(snapshot());
    const out = await guardTokenChecks(order, ticket(order), provider);

    expect(out.verdict).toBe("clear");
    expect(out.mismatches).toEqual([]);
    // nothing is asked when nothing disagrees — this runs on every webhook
    expect(fetchOrder).not.toHaveBeenCalled();
    expect(await mismatchRows()).toHaveLength(0);
  });

  /* The hole: `if (claims.accessKey && …)` compared the key only when it was
     there, so a validly signed token with no accessKey claim passed silently. */
  it("notices a token with no accessKey claim, and asks about it", async () => {
    const order = await place();
    const { provider, fetchOrder } = asker(snapshot());
    const out = await guardTokenChecks(
      order,
      ticket(order, { tokenChecks: { accessKey: "absent" } }),
      provider,
    );

    expect(out.mismatches).toEqual(["accessKey:absent"]);
    expect(out.verdict).toBe("confirmed");
    // asked about OUR order's uuid, with OUR access key — an answer of «paid»
    // can only ever be about this shop's own order
    expect(fetchOrder).toHaveBeenCalledWith(OURS);
    expect(await mismatchRows()).toMatchObject([{ number: order.number, verdict: "confirmed" }]);
  });

  /* The check that was never made at all: `decoded.uuid === montonioOrderId`. */
  it("notices a token naming a Montonio order this one is not", async () => {
    const order = await place();
    const { provider, fetchOrder } = asker(snapshot());
    const out = await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), provider);

    expect(out.mismatches).toEqual(["uuid"]);
    expect(fetchOrder).toHaveBeenCalledWith(OURS);
    expect(out.verdict).toBe("confirmed");
  });

  it("refuses when Montonio says the order is not paid", async () => {
    const order = await place();
    const { provider } = asker(snapshot({ paymentStatus: "PENDING" }));
    const out = await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), provider);

    expect(out.verdict).toBe("refused");
    expect(out.montonioStatus).toBe("PENDING");
    expect(await mismatchRows()).toMatchObject([{ verdict: "refused", montonioStatus: "PENDING" }]);
  });

  /* The whole point of the decision: a mismatch is not a verdict. Montonio
     itself vouches for the order, so the payment goes through — and it goes
     through on MONTONIO's figures, not on the token's. */
  it("settles on Montonio's own answer, not on the token's claims", async () => {
    const order = await place();
    const { provider } = asker(snapshot({ grandTotal: 42.5, currency: "EUR" }));
    const out = await guardTokenChecks(
      order,
      ticket(order, { providerRef: THEIRS, amount: 99.99 }),
      provider,
    );

    expect(out.verdict).toBe("confirmed");
    expect(out.result).toMatchObject({ status: "paid", providerRef: OURS, amount: 42.5 });
    /* …which is what feeds the short-payment hold: `grandTotal` is the figure
       Montonio's help centre warns an order reuse can lower. */
  });

  it("decides nothing at all when Montonio does not answer", async () => {
    const order = await place();
    const { provider } = asker(null);
    const out = await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), provider);

    // «unknown» is not «no»: the caller asks for the webhook to come back
    expect(out.verdict).toBe("unknown");
    expect(await mismatchRows()).toMatchObject([{ verdict: "unknown" }]);
  });

  it("spends no round trip on a pending ticket, which moves nothing anyway", async () => {
    const order = await place();
    const { provider, fetchOrder } = asker(snapshot());
    const out = await guardTokenChecks(
      order,
      ticket(order, { status: "pending", providerRef: THEIRS }),
      provider,
    );

    expect(out.verdict).toBe("clear");
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("does not invent a disagreement with an order that has no reference yet", async () => {
    const order = (await createOrder({
      lang: "RU",
      items: [{ id: PRODUCT.id, qty: 1 }],
      customer: { name: "Мария Тамм", email: "maria@example.com", phone: "" },
      shipping: { method: "pickup", country: "EE" },
    })) as unknown as Order;
    const { provider, fetchOrder } = asker(snapshot());

    const out = await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), provider);
    expect(out.verdict).toBe("clear");
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("cannot be confirmed by a provider that has nothing to ask", async () => {
    const order = await place();
    expect(canAskProvider(mute)).toBe(false);
    const out = await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), mute);
    expect(out.verdict).toBe("unknown");
  });

  it("writes one journal row for a mismatch, not thirteen", async () => {
    const order = await place();
    const { provider } = asker(snapshot());
    await guardTokenChecks(order, ticket(order, { providerRef: THEIRS }), provider);
    // the same webhook again, on the order as it stands once it is paid
    const paid = { ...order, status: "paid" as const };
    await guardTokenChecks(paid, ticket(order, { providerRef: THEIRS }), provider);

    expect(await mismatchRows()).toHaveLength(1);
  });

  /* `tokenChecks` is the provider saying «my token carries the claims that
     guide validates». The mock bank's does not — its `providerRef` is the
     order number, not a Montonio uuid — so it opts itself out of both checks
     rather than failing one of them on every single webhook. */
  it("says nothing about a provider that has no such claims at all", async () => {
    const order = await place();
    const { provider, fetchOrder } = asker(snapshot());
    const out = await guardTokenChecks(
      order,
      { orderRef: order.number, status: "paid", providerRef: OURS },
      provider,
    );
    expect(out.verdict).toBe("clear");
    expect(fetchOrder).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * …and the same three answers at the door the money actually comes through.
 * -------------------------------------------------------------------------- */

describe("POST /api/payments/notify/ with a token that fails a check", () => {
  const ACCESS = "OUR_ACCESS_KEY";
  const SECRET = "test-secret-key-at-least-16-chars";
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    process.env.E2E_BOOTSTRAP = "1";
    saved = {
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
      MONTONIO_ACCESS_KEY: process.env.MONTONIO_ACCESS_KEY,
      MONTONIO_SECRET_KEY: process.env.MONTONIO_SECRET_KEY,
    };
    delete process.env.PAYMENT_PROVIDER;
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
    await setupDb();
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    restoreEnv();
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    resetPayRateLimits();
    vi.unstubAllGlobals();
  });

  /** A Montonio order token naming a Montonio order this shop did not start. */
  function foreignToken(order: Order) {
    return signHs256(
      {
        uuid: THEIRS,
        accessKey: ACCESS,
        merchantReference: order.number,
        paymentStatus: "PAID",
        grandTotal: Number(order.total),
        currency: "EUR",
      },
      SECRET,
      { expiresInSeconds: 600 },
    );
  }

  /** What `GET /orders/:uuid` answers, or a refusal. */
  function stubMontonio(body: unknown, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (!String(url).includes("/orders/")) throw new Error(`unexpected fetch: ${url}`);
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  }

  async function notify(token: string) {
    const { POST } = await import("@/app/api/payments/notify/route");
    const res = await POST(
      makeRequest("/api/payments/notify/", { method: "POST", body: { orderToken: token } }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("settles it when Montonio says the order is paid", async () => {
    const order = await place();
    stubMontonio({
      uuid: OURS,
      paymentStatus: "PAID",
      grandTotal: Number(order.total),
      currency: "EUR",
      availableForRefund: 0,
    });

    const res = await notify(foreignToken(order));

    expect(res.status).toBe(200);
    expect((await getOrder(order.id))?.status).toBe("paid");
  });

  it("ignores it when Montonio says the order is not paid — and does not ask for a retry", async () => {
    const order = await place();
    stubMontonio({ uuid: OURS, paymentStatus: "PENDING", grandTotal: 0, currency: "EUR" });

    const res = await notify(foreignToken(order));

    // 200: a redelivery would be refused for exactly the same reason
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("token_mismatch");
    expect((await getOrder(order.id))?.status).toBe("new");
  });

  it("asks for the webhook again when Montonio cannot be reached", async () => {
    const order = await place();
    stubMontonio({ error: "boom" }, 500);

    const res = await notify(foreignToken(order));

    /* 503, never 200 and never 400: the shop does not know, and the one answer
       that buys another attempt is the one that says «come back». Montonio
       retries for 48 hours, 13 times. */
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("unconfirmed");
    expect((await getOrder(order.id))?.status).toBe("new");
  });
});
