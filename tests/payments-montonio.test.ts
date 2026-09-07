import { afterEach, describe, expect, it, vi } from "vitest";
import { JwtError, signHs256, verifyHs256 } from "@/lib/payments/jwt";
import {
  MontonioProvider,
  mapMontonioStatus,
  montonioBaseUrl,
  montonioConfigFromEnv,
} from "@/lib/payments/montonio";
import type { PaymentOrder } from "@/lib/payments/types";

const SECRET = "sample-montonio-secret-key-0123456789";
const ACCESS = "sample-access-key";

/** A fetch stub whose call signature survives typecheck, so mock.calls types. */
type FetchArgs = [input: string | URL | Request, init?: RequestInit];
function stubFetch(body: unknown, status = 200) {
  const mock = vi.fn(async (..._args: FetchArgs) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const provider = new MontonioProvider({
  accessKey: ACCESS,
  secretKey: SECRET,
  env: "sandbox",
});

const order: PaymentOrder = {
  id: "3f7c0d3e-1111-4444-8888-aaaaaaaaaaaa",
  number: "R-100042",
  total: 99.99,
  currency: "EUR",
  email: "customer@example.com",
  items: [{ name: "Kevin.Murphy Angel Wash 250 ml", quantity: 1, finalPrice: 99.99 }],
  address: {
    firstName: "Mari",
    lastName: "Tamm",
    email: "customer@example.com",
    addressLine1: "Kai 1",
    locality: "Tallinn",
    postalCode: "10111",
    country: "EE",
  },
};

/** A token shaped like the one Montonio sends back — same secret, same claims. */
function montonioToken(claims: Record<string, unknown>, secret = SECRET) {
  return signHs256(
    {
      uuid: "the-montonio-order-uuid",
      accessKey: ACCESS,
      merchantReference: "R-100042",
      paymentStatus: "PAID",
      grandTotal: 99.99,
      currency: "EUR",
      ...claims,
    },
    secret,
    { expiresInSeconds: 600 },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HS256 JWT", () => {
  it("round-trips a payload", () => {
    const token = signHs256({ merchantReference: "R-100042", grandTotal: 99.99 }, SECRET, {
      expiresInSeconds: 600,
    });
    const claims = verifyHs256<{ merchantReference: string; grandTotal: number; exp: number }>(
      token,
      SECRET,
    );
    expect(claims.merchantReference).toBe("R-100042");
    expect(claims.grandTotal).toBe(99.99);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(token.split(".")).toHaveLength(3);
  });

  it("rejects a tampered payload", () => {
    const token = signHs256({ grandTotal: 10 }, SECRET);
    const [header, , signature] = token.split(".");
    // re-encode the claims with a bigger number, keep the original signature
    const forged = Buffer.from(JSON.stringify({ grandTotal: 10_000 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => verifyHs256(`${header}.${forged}.${signature}`, SECRET)).toThrow(JwtError);
    try {
      verifyHs256(`${header}.${forged}.${signature}`, SECRET);
    } catch (err) {
      expect((err as JwtError).code).toBe("jwt_signature");
    }
  });

  it("rejects a flipped signature, the wrong secret and a truncated token", () => {
    const token = signHs256({ a: 1 }, SECRET);
    const flipped = token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
    expect(() => verifyHs256(flipped, SECRET)).toThrow(JwtError);
    expect(() => verifyHs256(token, "some-other-secret")).toThrow(JwtError);
    expect(() => verifyHs256(token.split(".").slice(0, 2).join("."), SECRET)).toThrow(JwtError);
  });

  it("refuses alg:none instead of trusting it", () => {
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ paymentStatus: "PAID" })}.`;
    try {
      verifyHs256(token, SECRET);
      expect.unreachable("alg:none must not verify");
    } catch (err) {
      expect((err as JwtError).code).toBe("jwt_alg");
    }
  });

  it("refuses an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = signHs256({ exp: past }, SECRET);
    try {
      verifyHs256(token, SECRET);
      expect.unreachable("an expired token must not verify");
    } catch (err) {
      expect((err as JwtError).code).toBe("jwt_expired");
    }
  });
});

describe("configuration", () => {
  it("picks the sandbox host unless MONTONIO_ENV says live", () => {
    expect(montonioBaseUrl("sandbox")).toBe("https://sandbox-stargate.montonio.com/api");
    expect(montonioBaseUrl("live")).toBe("https://stargate.montonio.com/api");
    expect(montonioConfigFromEnv(env({}))).toBeNull();
    expect(
      montonioConfigFromEnv(env({ MONTONIO_ACCESS_KEY: ACCESS, MONTONIO_SECRET_KEY: SECRET }))?.env,
    ).toBe("sandbox");
    expect(
      montonioConfigFromEnv(
        env({ MONTONIO_ACCESS_KEY: ACCESS, MONTONIO_SECRET_KEY: SECRET, MONTONIO_ENV: "live" }),
      )?.env,
    ).toBe("live");
  });
});

describe("createPayment", () => {
  it("posts a signed order and returns the gateway URL", async () => {
    const fetchMock = stubFetch({
      uuid: "montonio-uuid-1",
      paymentUrl: "https://gateway.montonio.com/x",
    });

    const out = await provider.createPayment(order, {
      returnUrl: "https://rempire.ee/api/payments/return/",
      notificationUrl: "https://rempire.ee/api/payments/notify/",
      lang: "RU",
      method: "bank",
      bank: "LHVBEE22",
      country: "EE",
    });

    expect(out).toEqual({ redirectUrl: "https://gateway.montonio.com/x", ref: "montonio-uuid-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-stargate.montonio.com/api/orders");
    const body = JSON.parse(String(init?.body)) as { data: string };

    // the request body is one signed JWT under `data`
    const claims = verifyHs256<Record<string, unknown>>(body.data, SECRET);
    expect(claims.accessKey).toBe(ACCESS);
    expect(claims.merchantReference).toBe("R-100042");
    expect(claims.grandTotal).toBe(99.99);
    expect(claims.currency).toBe("EUR");
    expect(claims.locale).toBe("ru");
    expect(claims.returnUrl).toBe("https://rempire.ee/api/payments/return/");
    expect(claims.notificationUrl).toBe("https://rempire.ee/api/payments/notify/");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const payment = claims.payment as Record<string, unknown>;
    expect(payment.method).toBe("paymentInitiation");
    expect(payment.amount).toBe(99.99);
    expect(payment.currency).toBe("EUR");
    const options = payment.methodOptions as Record<string, unknown>;
    expect(options.preferredProvider).toBe("LHVBEE22");
    expect(options.preferredCountry).toBe("EE");
    expect(options.preferredLocale).toBe("ru");

    expect(claims.lineItems).toEqual([
      { name: "Kevin.Murphy Angel Wash 250 ml", quantity: 1, finalPrice: 99.99 },
    ]);
    expect((claims.billingAddress as Record<string, unknown>).country).toBe("EE");
  });

  it("asks for card payments when the shopper chose a card", async () => {
    const fetchMock = stubFetch({ uuid: "u", paymentUrl: "https://gateway/x" });
    await provider.createPayment(order, {
      returnUrl: "https://rempire.ee/api/payments/return/",
      notificationUrl: "https://rempire.ee/api/payments/notify/",
      lang: "ET",
      method: "card",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const claims = verifyHs256<Record<string, unknown>>(body.data, SECRET);
    const payment = claims.payment as Record<string, unknown>;
    expect(payment.method).toBe("cardPayments");
    // the card half of the card page, not the wallet buttons Montonio opens on
    // by default (methodOptions.preferredMethod defaults to "wallet")
    expect((payment.methodOptions as Record<string, unknown>).preferredMethod).toBe("card");
    expect(claims.locale).toBe("et");
  });

  it("opens the card page on its wallet half when the shopper tapped Apple Pay / Google Pay", async () => {
    const fetchMock = stubFetch({ uuid: "u", paymentUrl: "https://gateway/x" });
    await provider.createPayment(order, {
      returnUrl: "https://rempire.ee/api/payments/return/",
      notificationUrl: "https://rempire.ee/api/payments/notify/",
      lang: "RU",
      method: "wallet",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const claims = verifyHs256<Record<string, unknown>>(body.data, SECRET);
    const payment = claims.payment as Record<string, unknown>;
    /* One page, two halves: `preferredMethod` says which one the shopper
       lands on. "card" for a wallet meant the card form first — the whole
       point of tapping Apple Pay lost a step down the page. */
    expect((payment.methodOptions as Record<string, unknown>).preferredMethod).toBe("wallet");
  });

  it("asks for the card page for Apple Pay / Google Pay too — the wallets live on it, never on the bank list", async () => {
    const fetchMock = stubFetch({ uuid: "u", paymentUrl: "https://gateway/x" });
    await provider.createPayment(order, {
      returnUrl: "https://rempire.ee/api/payments/return/",
      notificationUrl: "https://rempire.ee/api/payments/notify/",
      lang: "RU",
      method: "wallet",
      // a bank chip that happened to be highlighted must not travel with a wallet
      bank: "LHVBEE22",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const claims = verifyHs256<Record<string, unknown>>(body.data, SECRET);
    const payment = claims.payment as Record<string, unknown>;
    expect(payment.method).toBe("cardPayments");
    expect((payment.methodOptions as Record<string, unknown>).preferredProvider).toBeUndefined();
  });

  it("rounds money to two decimals", async () => {
    const fetchMock = stubFetch({ uuid: "u", paymentUrl: "https://gateway/x" });
    await provider.createPayment(
      { ...order, total: 10.1 + 20.2, items: [{ name: "x", quantity: 1, finalPrice: 30.299999 }] },
      {
        returnUrl: "https://rempire.ee/api/payments/return/",
        notificationUrl: "https://rempire.ee/api/payments/notify/",
        lang: "EN",
      },
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const claims = verifyHs256<Record<string, unknown>>(body.data, SECRET);
    expect(claims.grandTotal).toBe(30.3);
    expect((claims.lineItems as Array<{ finalPrice: number }>)[0].finalPrice).toBe(30.3);
  });

  it("surfaces a provider refusal as a payment error", async () => {
    stubFetch("nope", 422);
    await expect(
      provider.createPayment(order, {
        returnUrl: "https://rempire.ee/api/payments/return/",
        notificationUrl: "https://rempire.ee/api/payments/notify/",
        lang: "RU",
      }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
  });
});

describe("status mapping", () => {
  it("maps Montonio's lifecycle onto the shop's three outcomes", () => {
    expect(mapMontonioStatus("PAID")).toBe("paid");
    expect(mapMontonioStatus("paid")).toBe("paid");
    expect(mapMontonioStatus("PENDING")).toBe("pending");
    expect(mapMontonioStatus("AUTHORIZED")).toBe("pending");
    expect(mapMontonioStatus("ABANDONED")).toBe("failed");
    expect(mapMontonioStatus("VOIDED")).toBe("failed");
    // an unknown status must never be read as a failure
    expect(mapMontonioStatus("SOMETHING_NEW")).toBe("pending");
    expect(mapMontonioStatus(undefined)).toBe("pending");
  });
});

describe("verifyReturn / verifyNotification", () => {
  it("reads a paid order token off the return URL", async () => {
    const params = new URLSearchParams({ "order-token": montonioToken({}) });
    const result = await provider.verifyReturn(params);
    expect(result).toMatchObject({
      orderRef: "R-100042",
      status: "paid",
      providerRef: "the-montonio-order-uuid",
      amount: 99.99,
      currency: "EUR",
    });
  });

  it("maps an abandoned payment to failed", async () => {
    const params = new URLSearchParams({
      "order-token": montonioToken({ paymentStatus: "ABANDONED" }),
    });
    await expect(provider.verifyReturn(params)).resolves.toMatchObject({ status: "failed" });
  });

  it("refuses a tampered return token", async () => {
    const token = montonioToken({});
    const [header, claims, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(claims, "base64").toString()), grandTotal: 1 }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const params = new URLSearchParams({ "order-token": `${header}.${forged}.${signature}` });
    await expect(provider.verifyReturn(params)).rejects.toMatchObject({ code: "token_signature" });
  });

  it("refuses a token signed with someone else's secret", async () => {
    const params = new URLSearchParams({ "order-token": montonioToken({}, "not-our-secret") });
    await expect(provider.verifyReturn(params)).rejects.toMatchObject({ code: "token_signature" });
  });

  it("refuses a validly signed token for another store", async () => {
    const params = new URLSearchParams({
      "order-token": montonioToken({ accessKey: "another-store" }),
    });
    await expect(provider.verifyReturn(params)).rejects.toMatchObject({ code: "token_foreign" });
  });

  it("refuses a return with no token at all", async () => {
    await expect(provider.verifyReturn(new URLSearchParams())).rejects.toMatchObject({
      code: "missing_token",
    });
  });

  it("reads the webhook body's orderToken", async () => {
    const req = new Request("https://rempire.ee/api/payments/notify/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderToken: montonioToken({ paymentStatus: "PAID" }) }),
    });
    await expect(provider.verifyNotification(req)).resolves.toMatchObject({
      orderRef: "R-100042",
      status: "paid",
    });
  });

  it("ignores a refund webhook rather than acting on it", async () => {
    const req = new Request("https://rempire.ee/api/payments/notify/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refundToken: montonioToken({}) }),
    });
    await expect(provider.verifyNotification(req)).rejects.toMatchObject({
      code: "not_order_webhook",
    });
  });
});
