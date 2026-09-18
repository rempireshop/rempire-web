import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyHs256 } from "@/lib/payments/jwt";
import {
  MontonioProvider,
  mapMontonioRefundStatus,
  montonioErrorText,
} from "@/lib/payments/montonio";
import { PaymentError } from "@/lib/payments/types";

/**
 * «Montonio отказал в возврате — проверьте баланс в его панели.»
 *
 * Three refunds refused on 18.09.2026, and the sentence the owner was shown
 * blamed the one cause that cannot produce a refusal. Montonio's refunds guide
 * (https://docs.montonio.com/api/stargate/guides/refunds, checked 18.09.2026)
 * says it twice over:
 *
 *   · a refund with no money behind it is answered **200** with
 *     `status: "PENDING"`, and the reason arrives later on the refund webhook
 *     as `refundStatusDescription: "INSUFFICIENT_FUNDS"`. The help centre puts
 *     a clock on it — it retries for up to ten days and is then CANCELED;
 *   · the refusals that ARE HTTP errors are five, and every one of them names
 *     itself in the response body.
 *
 * So the body is the answer, and throwing it away is what left «отказал» with
 * nothing behind it. These tests pin the body to the error the panel gets.
 */

const SECRET = "sk_test_secret";
const ACCESS = "ak_test";
const ORDER_UUID = "12228dce-2f7c-4db5-8d28-5d82a19aa3b6";

const provider = new MontonioProvider({ accessKey: ACCESS, secretKey: SECRET, env: "sandbox" });

type Seen = { url: string; body: string; headers: Record<string, string> };

function stub(status: number, body: unknown, seen: Seen[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        body: String(init?.body ?? ""),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("montonioErrorText — Montonio's five documented refusals, read back", () => {
  /* Verbatim from the refunds guide's «Some exceptions that can be thrown by
     the API» table. The shape of the body is not documented, so the helper
     must cope with the usual keys and with plain text. */
  it("names the duplicate idempotency key", () => {
    expect(
      montonioErrorText(
        400,
        JSON.stringify({
          message: `Order uuid [${ORDER_UUID}] already has a refund with same idempotency key`,
        }),
      ),
    ).toBe(
      `HTTP 400 · Order uuid [${ORDER_UUID}] already has a refund with same idempotency key`,
    );
  });

  it("names an amount over what is refundable — the 0-balance case included", () => {
    const text = montonioErrorText(
      400,
      JSON.stringify({ message: "Refund amount [30] exceeds the total amount refundable [0]" }),
    );
    expect(text).toBe("HTTP 400 · Refund amount [30] exceeds the total amount refundable [0]");
  });

  it("names an amount under the 0.05 € minimum", () => {
    expect(
      montonioErrorText(400, JSON.stringify({ error: "amount is under the min allowed amount: 0.05EUR" })),
    ).toContain("0.05EUR");
  });

  it("tells a wrong access key from a wrong secret key", () => {
    expect(montonioErrorText(401, JSON.stringify({ message: "STORE_NOT_FOUND" }))).toBe(
      "HTTP 401 · STORE_NOT_FOUND",
    );
    expect(montonioErrorText(403, JSON.stringify({ message: "INVALID_TOKEN" }))).toBe(
      "HTTP 403 · INVALID_TOKEN",
    );
  });

  it("keeps the status when the body is plain text, empty or unparseable", () => {
    expect(montonioErrorText(502, "<html>Bad Gateway</html>")).toBe("HTTP 502 · <html>Bad Gateway</html>");
    expect(montonioErrorText(500, "")).toBe("HTTP 500");
    expect(montonioErrorText(400, "{not json")).toBe("HTTP 400 · {not json");
  });

  it("reads a message array, and never grows past a log line", () => {
    expect(montonioErrorText(400, JSON.stringify({ message: ["amount must be a number", "amount is required"] })))
      .toBe("HTTP 400 · amount must be a number; amount is required");
    expect(montonioErrorText(400, JSON.stringify({ message: "x".repeat(900) })).length)
      .toBeLessThanOrEqual("HTTP 400 · ".length + 300);
  });
});

describe("refundPayment — the refusal reaches the caller with Montonio's own words", () => {
  it("keeps the code and attaches the body as `detail`", async () => {
    stub(400, { message: "Refund amount [30] exceeds the total amount refundable [0]" });
    const err = await provider
      .refundPayment({ providerRef: ORDER_UUID, amount: 30, idempotencyKey: "k", orderNumber: "R-100042" })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentError);
    // the code is untouched: the panel's sentence and every caller still match on it
    expect((err as PaymentError).code).toBe("provider_rejected");
    expect((err as PaymentError).message).toBe("provider_rejected");
    expect((err as PaymentError).detail).toBe(
      "HTTP 400 · Refund amount [30] exceeds the total amount refundable [0]",
    );
  });

  it("carries a wrong-key refusal too — 401 and 403 are not the same fix", async () => {
    stub(401, { message: "STORE_NOT_FOUND" });
    await expect(
      provider.refundPayment({ providerRef: ORDER_UUID, amount: 5, idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "provider_rejected", detail: "HTTP 401 · STORE_NOT_FOUND" });

    stub(403, { message: "INVALID_TOKEN" });
    await expect(
      provider.refundPayment({ providerRef: ORDER_UUID, amount: 5, idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "provider_rejected", detail: "HTTP 403 · INVALID_TOKEN" });
  });

  it("an empty settlement account is NOT a refusal — 200 PENDING is money on its way", async () => {
    stub(200, {
      uuid: "97b20084-319a-4cce-92f5-56d3b41a986a",
      amount: 25,
      status: "PENDING",
      currency: "EUR",
      createdAt: "2026-09-18T08:37:55.534Z",
      type: "PARTIAL_REFUND",
    });
    const out = await provider.refundPayment({
      providerRef: ORDER_UUID,
      amount: 25,
      idempotencyKey: "k",
    });
    expect(out.status).toBe("pending");
    // and the reason only ever arrives on the refund webhook, never as HTTP
    expect(mapMontonioRefundStatus("PENDING")).toBe("pending");
    expect(mapMontonioRefundStatus("REJECTED")).toBe("failed");
    expect(mapMontonioRefundStatus("CANCELED")).toBe("failed");
  });
});

describe("GET /orders/:orderUuid — what Montonio itself says about the payment", () => {
  it("asks with the Bearer JWT the API reference prescribes for GET endpoints", async () => {
    const seen = stub(200, { uuid: ORDER_UUID, paymentStatus: "PAID", availableForRefund: 0 });
    await provider.fetchOrder(ORDER_UUID);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`https://sandbox-stargate.montonio.com/api/orders/${ORDER_UUID}`);
    const auth = seen[0].headers.authorization ?? "";
    expect(auth.startsWith("Bearer ")).toBe(true);
    const claims = verifyHs256<{ accessKey: string; exp: number; iat: number }>(
      auth.slice("Bearer ".length),
      SECRET,
    );
    // the minimum payload for all requests: accessKey + exp (API reference)
    expect(claims.accessKey).toBe(ACCESS);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("reads the two fields that explain a refused refund", async () => {
    stub(200, {
      uuid: ORDER_UUID,
      paymentStatus: "PAID",
      grandTotal: "100.00",
      currency: "EUR",
      availableForRefund: 50,
      isRefundableType: false,
      refunds: [
        { uuid: "92b11684-319a-4cce-92f5-56d348aa986a", amount: "25", status: "SUCCESSFUL" },
        { uuid: "8453465a-a9d8-469e-a838-5b2b5b20f429", amount: "25", status: "SUCCESSFUL" },
      ],
    });
    const snap = await provider.fetchOrder(ORDER_UUID);
    expect(snap).toMatchObject({
      paymentStatus: "PAID",
      grandTotal: 100,
      currency: "EUR",
      availableForRefund: 50,
      isRefundableType: false,
    });
    expect(snap!.refunds).toHaveLength(2);
    expect(snap!.refunds[0]).toEqual({
      uuid: "92b11684-319a-4cce-92f5-56d348aa986a",
      amount: 25,
      status: "SUCCESSFUL",
    });
  });

  it("does not call a field it cannot see `false` — absent is not «refunds are off»", async () => {
    stub(200, { uuid: ORDER_UUID, paymentStatus: "PAID" });
    const snap = await provider.fetchOrder(ORDER_UUID);
    expect(snap!.isRefundableType).toBeUndefined();
    expect(snap!.availableForRefund).toBe(0);
    expect(snap!.refunds).toEqual([]);
  });

  it("answers null rather than throwing — an explanation must never become a second failure", async () => {
    stub(401, { message: "STORE_NOT_FOUND" });
    expect(await provider.fetchOrder(ORDER_UUID)).toBeNull();

    stub(200, "not json at all");
    expect(await provider.fetchOrder(ORDER_UUID)).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await provider.fetchOrder(ORDER_UUID)).toBeNull();

    // and it never asks about nothing
    const seen = stub(200, {});
    expect(await provider.fetchOrder("  ")).toBeNull();
    expect(seen).toHaveLength(0);
  });
});
