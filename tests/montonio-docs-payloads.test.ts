/**
 * The paths sandbox cannot exercise, tested against the DOCUMENTATION'S OWN
 * payloads.
 *
 * Every constant in this file is copied from a Montonio page (read 18.09.2026)
 * and nothing in it was derived from what our code happens to produce. That
 * distinction is not academic: `src/lib/shipping/webhook.ts` was broken for
 * months because `tests/shipping-webhook.test.ts` built its fixture flat to
 * match the code, while the real payload nests everything under `data`. The
 * suite was green the whole time (docs/montonio-shipping-audit.md § 1.1).
 *
 * What is pinned here, and why each one matters:
 *
 *   1. the refund webhook token — the ONLY place `refundStatusDescription`
 *      ever appears, and the only way this shop can ever learn that a refund
 *      failed for lack of funds. `POST /refunds` answered 200 and said
 *      nothing;
 *   2. the `POST /refunds` success body, whose `status` is **PENDING** —
 *      a refund that has only started, which the panel used to call done;
 *   3. `GET /orders/:orderUuid`, whose `availableForRefund` and
 *      `isRefundableType` are the only evidence anywhere in the API that
 *      «Refundable bank payments» is switched on. Note the money arrives as
 *      **strings** in this response and as a number in `availableForRefund`;
 *   4. `GET /stores/payment-methods`, where the presence of a key IS the
 *      activation signal;
 *   5. the shipping webhook token, nested `data` and all, for
 *      `shipment.registered` and for `shipment.registrationFailed`;
 *   6. `POST /shipments` answering `registrationFailed` — the carrier
 *      refusing a parcel, which sandbox cannot produce at all because it
 *      «doesn't make actual calls to carrier APIs»;
 *   7. `GET /carriers` and `GET /webhooks`, the shipping half's own answer to
 *      «what is this store actually signed up for».
 *
 * Sources: docs.montonio.com/api/stargate/{guides/refunds,guides/payment-methods,reference}
 * and docs.montonio.com/api/shipping-v2/{guides/webhooks,guides/shipments,reference}.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { readRefundStatusDescription } from "@/lib/montonio-problems";
import { createOrder, getOrder, listAudit, setOrderPayment, setOrderStatus } from "@/lib/orders";
import { signHs256, verifyHs256 } from "@/lib/payments/jwt";
import { refundsOf } from "@/lib/payments/refund";
import { fetchEnabledPaymentMethods, fetchPaymentMethods } from "@/lib/payments/methods";
import { MontonioProvider } from "@/lib/payments/montonio";
import { pendingRefunds } from "@/lib/payments/pending-refunds";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import {
  fetchMontonioCarrierContracts,
  fetchMontonioWebhooks,
  readWebhookSetup,
  shipmentOnOrder,
} from "@/lib/shipping/montonio";
import { verifyShipmentWebhook } from "@/lib/shipping/webhook";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* The access key Montonio prints in its own examples. Using it verbatim keeps
   every claim below exactly as the page has it, `accessKey` included — which
   is itself part of what is being tested (verifyToken refuses another store's). */
const ACCESS = "MY_ACCESS_KEY";
const SECRET = "test-secret-key-at-least-16-chars";
const ORIGIN = "https://rempireshop.com";

const provider = new MontonioProvider({ accessKey: ACCESS, secretKey: SECRET, env: "sandbox" });

/* ---------- 1. the refund webhook, verbatim ------------------------------- */

/** Refunds guide § «The decoded payload of a refund token». */
const REFUND_TOKEN_PAYLOAD = {
  refundUuid: "a721af46-2dcb-4223-a227-5f85d1606cfe",
  refundStatus: "SUCCESSFUL",
  refundStatusDescription: null,
  accessKey: "MY_ACCESS_KEY",
  refundAmount: 33.09,
  orderUuid: "4a9115b7-8e55-48f4-bd7e-febc2402e8a0",
  iat: 1692180523,
  exp: 1692785323,
};

/* ---------- 2. POST /refunds, verbatim ------------------------------------ */

/** Refunds guide § «Response». Note `status: "PENDING"` on a fresh refund. */
const REFUND_CREATED_BODY = {
  uuid: "97b20084-319a-4cce-92f5-56d3b41a986a",
  amount: 25,
  status: "PENDING",
  currency: "EUR",
  createdAt: "2023-05-23T08:37:55.534Z",
  type: "PARTIAL_REFUND",
};

/* ---------- 3. GET /orders/:orderUuid, verbatim --------------------------- */

/** API reference § «Get Order by UUID». Money as strings; the two fields that
    decide whether a refund can happen at all are at the bottom. */
const ORDER_BODY = {
  uuid: "0ac2124d-9f8e-4a29-816d-7eef5b9bb0fd",
  paymentStatus: "PARTIALLY_REFUNDED",
  locale: "et",
  merchantReference: "MY-ORDER-ID-123",
  merchantReferenceDisplay: "MY-ORDER-ID-123",
  merchantReturnUrl: "https://mystore.com/payment/return",
  merchantNotificationUrl: "https://mystore.com/payment/notify",
  grandTotal: "100.00",
  currency: "EUR",
  paymentMethodType: "cardPayments",
  paymentIntents: [
    {
      uuid: "293513c0-66b1-401a-8afa-75e1f5714516",
      paymentMethodType: "cardPayments",
      paymentMethodMetadata: {},
      amount: "100.00",
      currency: "EUR",
      status: "PAID",
      serviceFee: "3.15",
      serviceFeeCurrency: "EUR",
      createdAt: "2023-05-23T08:22:53.899Z",
    },
  ],
  refunds: [
    {
      uuid: "92b11684-319a-4cce-92f5-56d348aa986a",
      amount: "25",
      status: "SUCCESSFUL",
      currency: "EUR",
      createdAt: "2023-05-23T08:37:55.534Z",
      type: "PARTIAL_REFUND",
    },
  ],
  availableForRefund: 50,
  isRefundableType: false,
  lineItems: [{ name: "Hoverboard", quantity: 1, finalPrice: 100 }],
  expiresAt: null,
  createdAt: "2023-05-23T08:22:53.879Z",
};

/* ---------- 4. GET /stores/payment-methods, verbatim ---------------------- */

/** Display-payment-methods guide § «Response». Only the ENABLED methods appear. */
const PAYMENT_METHODS_BODY = {
  uuid: "0bafe86b-c5cf-4c88-ba28-484a8585f0f4",
  name: "Montonio Store",
  paymentMethods: {
    blik: { processor: "blik", logoUrl: "https://public.montonio.com/images/logos/blik.png" },
    cardPayments: {
      processor: "adyen",
      logoUrl: "https://public.montonio.com/images/logos/visa-mc-ap-gp.png",
      requiredToBeEnabled: true,
    },
    mobilePay: {
      processor: "adyen",
      logoUrl: "https://public.montonio.com/images/logos/mobilepay.png",
      requiredToBeEnabled: true,
    },
    bnpl: { processor: "inbank", logoUrl: "https://public.montonio.com/images/logos/inbank_bnpl.png" },
    hirePurchase: {
      processor: "inbank",
      logoUrl: "https://public.montonio.com/images/logos/inbank_hire_purchase.png",
    },
    paymentInitiation: { processor: "montonio", setup: {} },
  },
};

/* ---------- 5. the shipping webhook, verbatim ----------------------------- */

/** Shipping webhooks guide § «The decoded payload». Everything is under `data`. */
const SHIPMENT_WEBHOOK_PAYLOAD = {
  eventId: "e1be81fb-2355-44b2-9f28-2b1a691151bb",
  shipmentId: "87f55147-7765-4eb6-9bb1-3c1a4b05a435",
  created: "2024-06-13T10:51:57.322Z",
  data: {
    id: "87f55147-7765-4eb6-9bb1-3c1a4b05a435",
    createdAt: "2024-06-13T10:51:55.288Z",
    status: "registered",
    montonioOrderUuid: null,
    merchantReference: "order 1",
    carrierShipmentId: null,
    shippingMethod: {
      type: "pickupPoint",
      id: "377c3b06-0967-4ff2-b28a-372cab234898",
      carrierCode: "omniva",
      countryCode: "EE",
    },
    sender: {},
    receiver: {},
    parcels: [
      {
        id: "0b10c1e1-beaa-4b09-9bb6-c6dd4002114d",
        weight: 1,
        length: null,
        height: null,
        width: null,
        carrierParcelId: "CC548936341EE",
        trackingLink: "https://minu.omniva.ee/track/CC548936341EE?language=et",
      },
    ],
    store: { id: "088ae409-ae24-4a3c-a640-5c269f732caa" },
    products: null,
  },
  eventType: "shipment.registered",
  iat: 1718275917,
  exp: 1718880717,
};

/* ---------- 7. GET /carriers and GET /webhooks, verbatim ------------------ */

/** Shipping reference § «Get carriers». */
const CARRIERS_BODY = {
  carriers: [
    {
      id: "aa8c5e19-ab56-425a-b8b8-7564b690a080",
      code: "smartpost",
      name: "SmartPosti",
      hasMontonioContract: true,
      supportedContractTypes: ["DIRECT", "MONTONIO"],
      contracts: null,
    },
    {
      id: "d292aff8-709e-4d46-9e49-be0a9670eddf",
      code: "omniva",
      name: "Omniva",
      hasMontonioContract: true,
      contracts: [{ id: "8c804942-4258-4fb1-b1a3-e3ac391f303c", country: "EE", isDirectContract: true }],
    },
  ],
};

/** Shipping reference § «Get webhooks». */
const WEBHOOKS_BODY = {
  data: [
    {
      id: "92965086-24a3-4fbd-919a-661142210c48",
      url: "http://partner.montonio/shipmentEvents",
      enabledEvents: ["shipment.registered"],
    },
  ],
};

/* ---------- rig ----------------------------------------------------------- */

/**
 * A documented payload, dated today.
 *
 * The published examples carry real `iat`/`exp` pairs from 2023 and 2024, so a
 * token signed with them verbatim is expired before it is written — `exp` is
 * the transport's clock, not the content, and `signHs256()` leaves an `exp`
 * that is already there alone. Everything else is untouched: the field names,
 * the nesting, the values and the `null`s are exactly as the page prints them,
 * which is the only property this file is here to defend.
 */
function fresh<T extends Record<string, unknown>>(payload: T): Omit<T, "iat" | "exp"> {
  const { iat: _iat, exp: _exp, ...rest } = payload;
  return rest;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(routes: Array<[RegExp, (init?: RequestInit) => Response]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      for (const [re, handler] of routes) if (re.test(url)) return handler(init);
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

function withKeys() {
  process.env.MONTONIO_ACCESS_KEY = ACCESS;
  process.env.MONTONIO_SECRET_KEY = SECRET;
  process.env.MONTONIO_ENV = "sandbox";
  process.env.PAYMENT_PROVIDER = "montonio";
}
function withoutKeys() {
  delete process.env.MONTONIO_ACCESS_KEY;
  delete process.env.MONTONIO_SECRET_KEY;
  delete process.env.MONTONIO_ENV;
  delete process.env.PAYMENT_PROVIDER;
  /* The readiness route compares the registered webhook against this shop's
     own address, so the tests that set it must not leak it into the ones that
     check what happens without it. */
  delete process.env.PUBLIC_BASE_URL;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  withoutKeys();
});

/* ---------- the payloads, through the real readers ------------------------ */

describe("the refund webhook Montonio documents", () => {
  const body = (claims: Record<string, unknown>) =>
    new Request(`${ORIGIN}/api/payments/notify/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refundToken: signHs256(fresh(claims), SECRET, { expiresInSeconds: 600 }) }),
    });

  it("reads the guide's own token, `refundStatusDescription: null` included", async () => {
    const note = await provider.verifyRefundNotification(body(REFUND_TOKEN_PAYLOAD));
    expect(note).toMatchObject({
      refundRef: "a721af46-2dcb-4223-a227-5f85d1606cfe",
      providerOrderRef: "4a9115b7-8e55-48f4-bd7e-febc2402e8a0",
      amount: 33.09,
      status: "done",
    });
    /* `null` is the documented value on a refund that simply worked, and it
       must not become the string "null" on the way in. */
    expect(note.statusDescription).toBeUndefined();
  });

  it("carries INSUFFICIENT_FUNDS out of the token — the only place it is ever said", async () => {
    /* This is the webhook the 18.09.2026 refunds would have produced if they
       had got as far as being accepted: 200 PENDING at the counter, the real
       answer days later. Sandbox can never send it (no product, no refunds),
       so this payload is the only test there will be before go-live. */
    const note = await provider.verifyRefundNotification(
      body({
        ...REFUND_TOKEN_PAYLOAD,
        refundStatus: "PENDING",
        refundStatusDescription: "INSUFFICIENT_FUNDS",
      }),
    );
    expect(note.status).toBe("pending");
    expect(note.statusDescription).toBe("INSUFFICIENT_FUNDS");
    const why = readRefundStatusDescription(note.statusDescription);
    expect(why.reason).toBe("insufficient_funds");
    expect(why.messages.RU).toContain("10");
  });

  it("still refuses a validly signed token belonging to another store", async () => {
    await expect(
      provider.verifyRefundNotification(body({ ...REFUND_TOKEN_PAYLOAD, accessKey: "SOMEBODY_ELSE" })),
    ).rejects.toThrow("token_foreign");
  });
});

describe("POST /refunds answers with a refund that has only STARTED", () => {
  it("maps the guide's own 200 body to `pending`, not to done", async () => {
    stubFetch([[/\/refunds$/, () => json(REFUND_CREATED_BODY)]]);
    const out = await provider.refundPayment({
      providerRef: ORDER_BODY.uuid,
      amount: 25,
      idempotencyKey: "0f6b0f9c-4c8a-4e2f-8b7a-2a9e6d4c1b30",
    });
    expect(out).toMatchObject({ ref: REFUND_CREATED_BODY.uuid, amount: 25, status: "pending" });
    /* The type and the status ride along for the journal — «PARTIAL_REFUND ·
       PENDING» is what the order card has to show instead of «возврат ушёл». */
    expect(out.detail).toBe("PARTIAL_REFUND · PENDING");
  });
});

describe("GET /orders/:orderUuid — the only evidence refunds are switched on", () => {
  it("reads the reference's own response, strings and all", async () => {
    const calls = stubFetch([[/\/orders\//, () => json(ORDER_BODY)]]);
    const snap = await provider.fetchOrder(ORDER_BODY.uuid);
    expect(snap).toMatchObject({
      uuid: ORDER_BODY.uuid,
      paymentStatus: "PARTIALLY_REFUNDED",
      currency: "EUR",
      /* `"100.00"` is a STRING in this response and `50` is a number in the
         same object — both have to come out as money. */
      grandTotal: 100,
      availableForRefund: 50,
      isRefundableType: false,
      /* One line apart from `isRefundableType` in the reference's own example,
         and the reason that flag can be read at all: «will be true if you
         enabled refunds in montonio (and the user paid with a refundable
         method)». This example order is a CARD one, so its `false` says
         nothing about bank-link refunds (F12). */
      paymentMethodType: "cardPayments",
    });
    expect(snap!.refunds).toEqual([
      { uuid: "92b11684-319a-4cce-92f5-56d348aa986a", amount: 25, status: "SUCCESSFUL" },
    ]);
    // GET endpoints take the Bearer JWT the reference prescribes
    const auth = (calls[0].init?.headers as Record<string, string>).authorization;
    expect(auth).toMatch(/^Bearer /);
  });

  it("reports an ABSENT isRefundableType as unknown, never as «switched off»", async () => {
    const { isRefundableType: _drop, ...noFlag } = ORDER_BODY;
    stubFetch([[/\/orders\//, () => json(noFlag)]]);
    const snap = await provider.fetchOrder(ORDER_BODY.uuid);
    expect(snap!.isRefundableType).toBeUndefined();
  });
});

describe("GET /stores/payment-methods — presence of a key is the activation signal", () => {
  it("lists exactly the six methods the guide's store has enabled", async () => {
    withKeys();
    stubFetch([[/payment-methods$/, () => json(PAYMENT_METHODS_BODY)]]);
    expect(await fetchEnabledPaymentMethods()).toEqual([
      "blik",
      "bnpl",
      "cardPayments",
      "hirePurchase",
      "mobilePay",
      "paymentInitiation",
    ]);
  });

  it("an empty paymentMethods means «ничего не включено», and says so as []", async () => {
    withKeys();
    stubFetch([[/payment-methods$/, () => json({ uuid: "x", name: "y", paymentMethods: {} })]]);
    expect(await fetchEnabledPaymentMethods()).toEqual([]);
  });

  it("is null, not a throw, when Montonio will not answer", async () => {
    withKeys();
    stubFetch([[/payment-methods$/, () => json({ message: "nope" }, 500)]]);
    expect(await fetchEnabledPaymentMethods()).toBeNull();
  });
});

describe("a euro order is never offered a bank that only takes zloty", () => {
  /* The guide: «Bank Payments EUR, PLN». Since 22.09.2026 a parcel to Poland
     shows Poland's banks, and this shop only charges in euro. */
  const bank = (code: string, supportedCurrencies?: string[]) => ({
    code,
    name: code,
    logoUrl: "",
    ...(supportedCurrencies ? { supportedCurrencies } : {}),
  });
  const body = {
    paymentMethods: {
      paymentInitiation: {
        setup: {
          EE: { supportedCurrencies: ["EUR"], paymentMethods: [bank("HABAEE2X", ["EUR"]), bank("LHVBEE22")] },
          PL: {
            supportedCurrencies: ["EUR", "PLN"],
            paymentMethods: [bank("PKOPPLPW", ["PLN"]), bank("REVOLT21", ["EUR", "PLN"])],
          },
          XX: { supportedCurrencies: ["PLN"], paymentMethods: [bank("ZLOTYONLY")] },
        },
      },
    },
  };

  it("drops a PLN-only bank and a PLN-only country, keeps a bank that did not say", async () => {
    withKeys();
    delete (globalThis as { __rempirePayMethods?: unknown }).__rempirePayMethods;
    stubFetch([[/payment-methods$/, () => json(body)]]);
    const got = await fetchPaymentMethods();
    expect(got!.banks.map((b) => `${b.country}:${b.code}`)).toEqual([
      "EE:HABAEE2X",
      "EE:LHVBEE22",
      "PL:REVOLT21",
    ]);
    delete (globalThis as { __rempirePayMethods?: unknown }).__rempirePayMethods;
  });
});

describe("the shipping webhook Montonio documents", () => {
  const config = { accessKey: ACCESS, secretKey: SECRET, env: "sandbox" as const };
  const envelope = (claims: Record<string, unknown>) => ({
    payload: signHs256(fresh(claims), SECRET, { expiresInSeconds: 600 }),
  });

  it("reads status, order reference and tracking out of the nested `data`", () => {
    const event = verifyShipmentWebhook(envelope(SHIPMENT_WEBHOOK_PAYLOAD), config);
    expect(event).toEqual({
      event: "shipment.registered",
      shipmentId: "87f55147-7765-4eb6-9bb1-3c1a4b05a435",
      orderRef: "order 1",
      status: "registered",
      trackingCode: "CC548936341EE",
      // the documented sample's parcel carries a trackingLink and no dropOffPin
      trackingUrl: "https://minu.omniva.ee/track/CC548936341EE?language=et",
      dropOffPin: "",
    });
  });

  it("reads `shipment.registrationFailed` — the event this shop used to discard", () => {
    const failed = {
      ...SHIPMENT_WEBHOOK_PAYLOAD,
      eventType: "shipment.registrationFailed",
      data: { ...SHIPMENT_WEBHOOK_PAYLOAD.data, status: "registrationFailed", parcels: [] },
    };
    const event = verifyShipmentWebhook(envelope(failed), config);
    expect(event.event).toBe("shipment.registrationFailed");
    expect(event.status).toBe("registrationFailed");
    expect(event.orderRef).toBe("order 1");
  });
});

describe("GET /carriers and GET /webhooks — what this store is signed up for", () => {
  it("reads the contracts the reference prints", async () => {
    withKeys();
    stubFetch([[/\/carriers$/, () => json(CARRIERS_BODY)]]);
    expect(await fetchMontonioCarrierContracts()).toEqual({
      ok: true,
      data: [
        { code: "smartpost", name: "SmartPosti", montonioContract: true, ownCountries: [] },
        { code: "omniva", name: "Omniva", montonioContract: true, ownCountries: ["EE"] },
      ],
    });
  });

  it("reads the registered webhooks — the one setup step nothing else notices", async () => {
    withKeys();
    stubFetch([[/\/webhooks$/, () => json(WEBHOOKS_BODY)]]);
    expect(await fetchMontonioWebhooks()).toEqual({
      ok: true,
      data: [
        {
          id: "92965086-24a3-4fbd-919a-661142210c48",
          url: "http://partner.montonio/shipmentEvents",
          events: ["shipment.registered"],
        },
      ],
    });
  });

  it("says «не смогли спросить» rather than «ничего нет» when the call fails", async () => {
    withKeys();
    stubFetch([[/\/(carriers|webhooks)$/, () => json({ message: "boom" }, 500)]]);
    expect(await fetchMontonioCarrierContracts()).toMatchObject({ ok: false, status: 500 });
    expect(await fetchMontonioWebhooks()).toMatchObject({ ok: false, status: 500 });
  });

  /**
   * F14 — the status has to survive the probe.
   *
   * Refunds guide § errors: `401 STORE_NOT_FOUND - double check your access
   * key`, `403 INVALID_TOKEN - double check your secret key`. Both used to
   * arrive as `null`, indistinguishable from a timeout, and the panel printed
   * «Проверяем…» to an owner whose keys had just been refused.
   */
  it("carries 401 and 403 out of the probe instead of flattening them to null", async () => {
    withKeys();
    stubFetch([[/\/webhooks$/, () => json({ message: "STORE_NOT_FOUND - double check your access key" }, 401)]]);
    expect(await fetchMontonioWebhooks()).toMatchObject({ ok: false, status: 401 });

    stubFetch([[/\/webhooks$/, () => json({ message: "INVALID_TOKEN - double check your secret key" }, 403)]]);
    expect(await fetchMontonioWebhooks()).toMatchObject({ ok: false, status: 403 });
  });
});

/**
 * F13 — the reference's own example webhook, read properly.
 *
 * `GET /webhooks` returns `id, url, enabledEvents`. Until 19.09.2026 the
 * readiness route kept none of the three and asked only `length > 0`, and this
 * file's fixture — the reference's example, pointing at
 * `http://partner.montonio/shipmentEvents` and subscribed to one event this
 * shop does not act on — was asserted to be a correctly configured webhook.
 * A fixture shaped like the contract is only worth having if the assertion is
 * about the contract too.
 */
describe("readWebhookSetup — registered is not registered HERE", () => {
  const OURS = "https://rempireshop.com/api/shipping/notify/";
  /* The three the shop cannot do without since 24.09.2026 — `registered`
     joined when refusals started being repaired with PATCH. */
  const both = ["shipment.statusUpdated", "shipment.registrationFailed", "shipment.registered"];

  it("refuses the reference's own example webhook, which used to pass", () => {
    const setup = readWebhookSetup(
      WEBHOOKS_BODY.data.map((w) => ({ id: w.id, url: w.url, events: w.enabledEvents })),
      OURS,
    );
    expect(setup.state).toBe("wrong_url");
    expect(setup.urls).toEqual(["http://partner.montonio/shipmentEvents"]);
    expect(setup.expectedUrl).toBe(OURS);
  });

  it("calls the trailing slash what it is — a different address", () => {
    /* next.config.ts `trailingSlash: true`: a POST to the slashless spelling
       is answered 308 and the event never reaches the route. */
    const setup = readWebhookSetup(
      [{ id: "1", url: "https://rempireshop.com/api/shipping/notify", events: both }],
      OURS,
    );
    expect(setup.state).toBe("wrong_url");
  });

  it("accepts the right address and names the events that are missing", () => {
    expect(
      readWebhookSetup([{ id: "1", url: OURS, events: both }], OURS).state,
    ).toBe("ok");

    const half = readWebhookSetup(
      [{ id: "1", url: OURS, events: ["shipment.statusUpdated", "shipment.registered", "shipment.labelsCreated"] }],
      OURS,
    );
    expect(half.state).toBe("missing_events");
    /* An extra event (`labelsCreated`) is never a complaint. `registered` is
       required since 24.09.2026: a refused parcel is repaired with PATCH, and
       a re-registration that does not finish inside the PATCH brings its
       tracking code only in that event. */
    expect(half.missingEvents).toEqual(["shipment.registrationFailed"]);

    const three = readWebhookSetup(
      [{ id: "1", url: OURS, events: ["shipment.statusUpdated", "shipment.registrationFailed"] }],
      OURS,
    );
    expect(three.missingEvents).toEqual(["shipment.registered"]);
  });

  it("ignores the scheme and the case, because the address is still ours", () => {
    const setup = readWebhookSetup(
      [{ id: "1", url: "http://RempireShop.com/api/shipping/notify/", events: both }],
      OURS,
    );
    expect(setup.state).toBe("ok");
  });

  it("says «нет вебхука» for an empty list, and checks events when the base url is unknown", () => {
    expect(readWebhookSetup([], OURS).state).toBe("none");
    /* PUBLIC_BASE_URL unset — no address to compare, but a missing event is
       still a missing event. */
    const noBase = readWebhookSetup([{ id: "1", url: "https://x/y/", events: ["shipment.statusUpdated"] }], "");
    expect(noBase.state).toBe("missing_events");
    expect(noBase.expectedUrl).toBe("");
  });
});

/* ---------- the routes, on a real database -------------------------------- */

/* The answers these routes give, as the panel reads them. Written out rather
   than cast loose because the shape IS what is under test: `reason` and the
   three-language `messages` are the contract public/shop2/app.js leans on. */
type Msgs = { RU: string; ET: string; EN: string };
type RouteBody = {
  ok?: boolean;
  error?: string;
  reason?: string;
  detail?: string;
  reused?: boolean;
  refundStatus?: string;
  availableForRefund?: number;
  isRefundableType?: boolean;
  messages?: Msgs;
  pendingMessages?: Msgs;
  configured?: boolean;
  env?: string;
  payments?: { bankPayments?: boolean; cardPayments?: boolean; enabled?: string[] } | null;
  refunds?: {
    refundableBankPayments?: boolean | null;
    availableForRefund?: number | null;
    /** Montonio's own `paymentMethodType` for the sampled order (F12). */
    checkedMethod?: string | null;
  } | null;
  shipping?: {
    webhookRegistered?: boolean | null;
    carriers?: unknown[] | null;
    /** url, trailing slash and events, read rather than counted (F13). */
    webhook?: { state?: string; expectedUrl?: string; urls?: string[]; missingEvents?: string[] } | null;
  } | null;
  rows?: Array<{ key: string; ok: boolean; quiet?: boolean; sub: Msgs }>;
};

type Min = { id: string; s: string };
const PRODUCT = (catalogueMin as Min[]).find((p) => p.s === "in")!;
let ip = 0;

function req(path: string, init: RequestInit = {}, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `198.51.100.${(ip++ % 200) + 1}`,
  };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("the paths sandbox can never reach, on the real routes", () => {
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
    resetPayRateLimits();
    await truncateAll();
  });

  /* `bank | card | wallet` — our own vocabulary, which is what production
     writes (src/lib/payments/types.ts `PaymentMethodKind`). This fixture used
     to store `paymentInitiation`, a value no code path can produce, which hid
     the fact that the readiness route never looked at the method at all. */
  async function paidOrder(
    shipping: Record<string, unknown>,
    ref?: string,
    method: "bank" | "card" | "wallet" = "bank",
  ) {
    const order = await createOrder({
      lang: "RU",
      items: [{ id: PRODUCT.id, qty: 1 }],
      customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555555" },
      shipping: shipping as never,
    });
    if (ref) {
      await setOrderPayment(order.id, {
        provider: "montonio",
        ref,
        status: "paid",
        method,
        amount: Number(order.total),
        currency: "EUR",
        at: new Date().toISOString(),
      });
    }
    await setOrderStatus(order.id, "paid", "test");
    return (await getOrder(order.id))!;
  }

  /* ---- a refund Montonio refuses ---------------------------------------- */

  it("a refused refund names the cause, in three languages, and writes it down", async () => {
    withKeys();
    /* Montonio's own sentence for the case the owner met on 18.09.2026: the
       funds have not settled and/or refundable bank payments are off, so
       everything is «over the refundable total of 0». */
    stubFetch([
      [
        /\/refunds$/,
        () =>
          json({ message: "Refund amount [30] exceeds the total amount refundable [0]" }, 400),
      ],
      [/\/orders\//, () => json({ ...ORDER_BODY, availableForRefund: 0, isRefundableType: false })],
    ]);

    const order = await paidOrder({ method: "pickup", country: "EE" }, ORDER_BODY.uuid);
    const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
    const res = await POST(
      req(`/api/admin/orders/${order.id}/refund/`, { method: "POST", body: "{}" }, admin),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as RouteBody;
    expect(body.error).toBe("provider_rejected");
    expect(body.reason).toBe("nothing_refundable");
    expect(body.detail).toContain("exceeds the total amount refundable [0]");
    // what Montonio itself says about the order, fetched only after the refusal
    expect(body.availableForRefund).toBe(0);
    expect(body.isRefundableType).toBe(false);
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(String(body.messages![lang])).toContain("Refundable bank payments");
    }
    /* Never the sentence that started all this. */
    expect(String(body.messages!.RU)).not.toContain("проверьте баланс");

    const audit = await listAudit(10);
    const row = audit.find((a) => a.action === "order.refund_failed");
    expect(row).toBeTruthy();
    expect((row!.payload as { reason?: string }).reason).toBe("nothing_refundable");
  });

  /* The owner's own test, «Нажать "Вернуть деньги" второй раз», run here
     because on the stand he cannot run it at all: Montonio's sandbox refuses
     every refund, so there is never a first one to press again. This is that
     scenario in the shape he actually meets — the FIRST press refused — and
     the two things that must hold are the two he would look at: the same
     sentence both times, and no row appearing from a press that did nothing.
     (Dim, 19.09.2026: «I need a better explanation to the test - can you test
     this yourself?») */
  it("presses «Вернуть деньги» twice into a refusal: same words, no rows, one key", async () => {
    withKeys();
    /* The undocumented wording the owner met at 11:07 that morning. */
    const calls = stubFetch([
      [
        /\/refunds$/,
        () =>
          json({ message: "Payment intent 71b9ebe6-2d07-4f59-93b7-d5ed305b3b19 cannot be refunded at this time." }, 400),
      ],
      [/\/orders\//, () => json({ ...ORDER_BODY, availableForRefund: 0, refunds: [] })],
    ]);

    const order = await paidOrder({ method: "pickup", country: "EE" }, ORDER_BODY.uuid);
    const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
    const press = async () =>
      (await POST(
        req(`/api/admin/orders/${order.id}/refund/`, { method: "POST", body: JSON.stringify({ amount: 5 }) }, admin),
        { params: Promise.resolve({ id: order.id }) },
      )).json() as Promise<RouteBody>;

    const first = await press();
    const second = await press();

    expect(first.reason).toBe("not_refundable_now");
    expect(second.reason).toBe("not_refundable_now");
    // the same three sentences, so the second press teaches nothing new and asks for nothing
    expect(second.messages).toEqual(first.messages);
    expect(String(first.messages!.RU)).toContain("Ничего не списано");
    expect(String(first.messages!.RU)).not.toContain("cannot be refunded at this time");

    /* Nothing was taken, so nothing is written down: a refusal that left a row
       would be a refund the owner can see and the customer never got. */
    const stored = await getOrder(order.id);
    expect(refundsOf(stored!.payment)).toEqual([]);
    expect(stored!.status).toBe("paid");

    /* And both presses carried the SAME idempotency key — which is what makes
       a retry after a LOST answer ask Montonio about the refund it already
       made instead of making a second one. The key is derived from the order
       and the number of refunds on it, and neither moved. */
    const asked = calls
      .filter((c) => /\/refunds$/.test(c.url))
      .map((c) => String((JSON.parse(String(c.init?.body ?? "{}")) as { data?: string }).data ?? ""));
    expect(asked).toHaveLength(2);
    const keyOf = (token: string) => verifyHs256<Record<string, unknown>>(token, SECRET).idempotencyKey as string;
    expect(keyOf(asked[1])).toBe(keyOf(asked[0]));
  });

  it("a refund Montonio only accepted says so, and becomes a pending row to look at", async () => {
    withKeys();
    stubFetch([[/\/refunds$/, () => json({ ...REFUND_CREATED_BODY, amount: 5 })]]);

    const order = await paidOrder({ method: "pickup", country: "EE" }, ORDER_BODY.uuid);
    const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
    const res = await POST(
      req(`/api/admin/orders/${order.id}/refund/`, { method: "POST", body: JSON.stringify({ amount: 5 }) }, admin),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RouteBody;
    expect(body.refundStatus).toBe("pending");
    /* «Отправлено» is not «возвращено» — the panel has the words for it now. */
    expect(String(body.pendingMessages!.RU)).toMatch(/ещё не у покупателя/);
    expect(String(body.pendingMessages!.ET).length).toBeGreaterThan(20);
    expect(String(body.pendingMessages!.EN)).toMatch(/not with the customer yet/);

    const audit = await listAudit(10);
    expect(audit.some((a) => a.action === "order.refund_pending")).toBe(true);

    /* …and it is findable afterwards, which is the whole point: Montonio
       cancels a refund it cannot fund after ten days and tells nobody. */
    const stuck = await pendingRefunds();
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ number: order.number, amount: 5, overdue: false });
  });

  /* ---- a parcel the carrier refuses -------------------------------------- */

  it("a carrier that refuses the parcel is a refusal, not «Этикетка готова ✓»", async () => {
    withKeys();
    /* The shipments guide: with `synchronous: true` «the response will include
       the final registration status» — registered OR registrationFailed. The
       sandbox «doesn't make actual calls to carrier APIs», so this response
       has never once been seen by this code against Montonio. */
    const REFUSED = {
      id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
      createdAt: "2024-06-13T08:50:45.376Z",
      status: "registrationFailed",
      merchantReference: "R-100001",
      shippingMethod: { type: "pickupPoint", id: "377c3b06-0967-4ff2-b28a-372cab234898", carrierCode: "omniva", countryCode: "EE" },
      parcels: [{ id: "ba5184ea-6470-4a2d-b216-2eebc75db40e", weight: 1, carrierParcelId: null, trackingLink: null }],
    };
    stubFetch([[/\/shipments$/, () => json(REFUSED)]]);

    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: "377c3b06-0967-4ff2-b28a-372cab234898",
      pointName: "Laagri",
    });

    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as RouteBody;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("registration_failed");
    expect(body.reason).toBe("registration_failed");
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(String(body.messages![lang]).length).toBeGreaterThan(40);
    }

    /* The parcel EXISTS at Montonio, so it is stored — otherwise the next
       press books and pays for a second one. */
    const stored = shipmentOnOrder((await getOrder(order.id))!);
    expect(stored!.shipmentId).toBe(REFUSED.id);
    expect(stored!.status).toBe("registrationFailed");

    const audit = await listAudit(10);
    expect(audit.some((a) => a.action === "shipment.registration_failed")).toBe(true);
    expect(audit.some((a) => a.action === "shipment.create")).toBe(false);

    /* …and a second press says the same thing rather than «Этикетка снова на
       месте ✓», without touching Montonio again. */
    const again = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.number }) }, admin),
    );
    expect(again.status).toBe(502);
    const againBody = (await again.json()) as RouteBody;
    expect(againBody.error).toBe("registration_failed");
    expect(againBody.reused).toBeUndefined();

    /* …and asking for its label says the same thing too, instead of failing
       somewhere inside Montonio with nothing behind it. */
    const label = await import("@/app/api/admin/shipments/[id]/label/route");
    const labelRes = await label.GET(req(`/api/admin/shipments/${order.id}/label/`, {}, admin), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(labelRes.status).toBe(409);
    const labelBody = (await labelRes.json()) as RouteBody;
    expect(labelBody.error).toBe("registration_failed");
    expect(String(labelBody.messages!.ET).length).toBeGreaterThan(40);
  });

  it("the registrationFailed webhook lands on the order and in the journal", async () => {
    withKeys();
    const order = await paidOrder({ method: "pickup", country: "EE" });
    const failed = {
      ...SHIPMENT_WEBHOOK_PAYLOAD,
      eventType: "shipment.registrationFailed",
      data: {
        ...SHIPMENT_WEBHOOK_PAYLOAD.data,
        status: "registrationFailed",
        merchantReference: order.number,
        parcels: [],
      },
    };
    const { POST } = await import("@/app/api/shipping/notify/route");
    const res = await POST(
      req("/api/shipping/notify/", {
        method: "POST",
        body: JSON.stringify({ payload: signHs256(fresh(failed), SECRET, { expiresInSeconds: 600 }) }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("registrationFailed");

    const audit = await listAudit(10);
    const row = audit.find((a) => a.action === "shipment.registration_failed");
    expect(row).toBeTruthy();
    expect((row!.payload as { number?: string }).number).toBe(order.number);
  });

  /* ---- what the shop believes it can do ---------------------------------- */

  it("GET /api/admin/montonio reports the products, the contracts and the stuck refunds", async () => {
    withKeys();
    process.env.PUBLIC_BASE_URL = ORIGIN;
    /* A BANK-link order, because that is the only kind whose
       `isRefundableType` says anything about «Refundable bank payments». */
    await paidOrder({ method: "pickup", country: "EE" }, ORDER_BODY.uuid, "bank");
    stubFetch([
      [/payment-methods$/, () => json(PAYMENT_METHODS_BODY)],
      [
        /\/orders\//,
        () =>
          json({
            ...ORDER_BODY,
            paymentMethodType: "paymentInitiation",
            isRefundableType: false,
            availableForRefund: 0,
          }),
      ],
      [/\/carriers$/, () => json(CARRIERS_BODY)],
      [/\/webhooks$/, () => json(WEBHOOKS_BODY)],
    ]);

    const { GET } = await import("@/app/api/admin/montonio/route");
    const res = await GET(req("/api/admin/montonio/", {}, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RouteBody;
    expect(body.configured).toBe(true);
    expect(body.env).toBe("sandbox");
    expect(body.payments!.bankPayments).toBe(true);
    /* The whole point: «Bank payments» on, «Refundable bank payments» off —
       the shop that looks perfect until somebody asks for money back. */
    expect(body.refunds!.refundableBankPayments).toBe(false);
    expect(body.refunds!.checkedMethod).toBe("paymentInitiation");
    expect(body.refunds!.availableForRefund).toBe(0);
    expect(body.shipping!.carriers).toHaveLength(2);

    /* The screen's own rows come from the server in all three languages, so
       the panel prints them and adds no Russian literal of its own — which is
       what keeps `tools/i18n-gaps.mjs` at zero while these sentences change
       with Montonio rather than with the shop. */
    const refunds = body.rows!.find((r) => r.key === "refunds")!;
    expect(refunds.ok).toBe(false);
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(refunds.sub[lang]).toContain("Refundable bank payments");
    }

    /* F13: the reference's example webhook points at partner.montonio and is
       subscribed to one event this shop never acts on. `length > 0` used to
       call that «Настроено ✓». */
    expect(body.shipping!.webhook!.state).toBe("wrong_url");
    const hook = body.rows!.find((r) => r.key === "ship_webhook")!;
    expect(hook.ok).toBe(false);
    expect(hook.sub.RU).toContain(`${ORIGIN}/api/shipping/notify/`);

    /* F14: the keys answered, so the row says so rather than «Проверяем…». */
    expect(body.rows!.find((r) => r.key === "keys")!.ok).toBe(true);
  });

  /**
   * F12, on the reference's own order — which is a CARD one.
   *
   * `paymentMethodType: "cardPayments"` and `isRefundableType: false` sit two
   * lines apart in the published example, and cards are refundable by default
   * («enabled by default», refunds guide), so that `false` cannot be reported
   * as «bank refunds are off» — nor, on a `true`, as «refunds are on». The
   * probe used to take the newest paid order whatever it was.
   */
  it("will not read «Refundable bank payments» off a card order", async () => {
    withKeys();
    process.env.PUBLIC_BASE_URL = ORIGIN;
    await paidOrder({ method: "pickup", country: "EE" }, ORDER_BODY.uuid, "card");
    stubFetch([
      [/payment-methods$/, () => json(PAYMENT_METHODS_BODY)],
      // the reference's own body, isRefundableType: true — a card saying yes
      [/\/orders\//, () => json({ ...ORDER_BODY, isRefundableType: true })],
      [/\/carriers$/, () => json(CARRIERS_BODY)],
      [/\/webhooks$/, () => json(WEBHOOKS_BODY)],
    ]);

    const { GET } = await import("@/app/api/admin/montonio/route");
    const body = (await (await GET(req("/api/admin/montonio/", {}, admin))).json()) as RouteBody;
    expect(body.refunds!.checkedMethod).toBe("cardPayments");
    expect(body.refunds!.refundableBankPayments).toBeNull();

    const refunds = body.rows!.find((r) => r.key === "refunds")!;
    expect(refunds.quiet).toBe(true);
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(refunds.sub[lang]).toContain("cardPayments");
    }
  });

  /**
   * F14 — Sunday 21.09.2026, live keys pasted in by hand, one half wrong.
   *
   * Refunds guide § errors: `401 STORE_NOT_FOUND - double check your access
   * key`. Every probe used to swallow it, so the screen showed grey rows and
   * «как только пройдёт первая оплата» — which never comes, because
   * `POST /orders` answers 401 too.
   */
  it("says «Montonio не узнал ключи» when every probe comes back 401", async () => {
    withKeys();
    process.env.PUBLIC_BASE_URL = ORIGIN;
    stubFetch([
      [/./, () => json({ message: "STORE_NOT_FOUND - double check your access key" }, 401)],
    ]);

    const { GET } = await import("@/app/api/admin/montonio/route");
    const res = await GET(req("/api/admin/montonio/", {}, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RouteBody;

    const keys = body.rows!.find((r) => r.key === "keys")!;
    expect(keys.ok).toBe(false);
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(keys.sub[lang]).toContain("STORE_NOT_FOUND");
    }
    /* …and nothing else on the screen pretends to know anything. */
    expect(body.rows!.find((r) => r.key === "ship_webhook")!.quiet).toBe(true);
    expect(body.rows!.find((r) => r.key === "carriers")!.quiet).toBe(true);
  });

  it("…and with no keys at all it says so instead of guessing", async () => {
    const { GET } = await import("@/app/api/admin/montonio/route");
    const res = await GET(req("/api/admin/montonio/", {}, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RouteBody;
    expect(body.configured).toBe(false);
    expect(body.refunds).toBeNull();
  });

  it("needs the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/montonio/route");
    expect((await GET(req("/api/admin/montonio/"))).status).toBe(401);
  });
});
