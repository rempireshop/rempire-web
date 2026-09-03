/**
 * sendMail() against a mocked fetch: the happy path, the single 5xx retry,
 * and every reason we deliberately skip instead of throwing. An order that is
 * already paid for must never fail because Resend had a bad minute.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromAddress, replyToAddress, sendMail } from "@/lib/mail";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_FROM",
  "MAIL_REPLY_TO",
  "MAIL_RETRY_DELAY_MS",
] as const;

let saved: Record<string, string | undefined> = {};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0"; // no real pause between attempts
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LETTER = {
  to: "klient@example.com",
  subject: "Заказ R-100042 принят — Rempire",
  html: "<p>hi</p>",
  text: "hi",
};

describe("sendMail", () => {
  it("posts to Resend and reports the message id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "msg_1" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail({ ...LETTER, tags: { template: "order-confirmed" } });

    expect(res).toMatchObject({ ok: true, id: "msg_1", retried: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.from).toBe("Rempire <shop@rempireshop.com>");
    expect(body.to).toEqual(["klient@example.com"]);
    expect(body.subject).toBe(LETTER.subject);
    expect(body.html).toBe("<p>hi</p>");
    expect(body.text).toBe("hi");
    expect(body.tags).toEqual([
      { name: "template", value: "order-confirmed" },
    ]);
    // no MAIL_REPLY_TO configured → replies go to the shop mailbox by default
    expect(body.reply_to).toEqual("info@rempireshop.com");
  });

  it("uses RESEND_FROM and MAIL_REPLY_TO when they are set", async () => {
    process.env.RESEND_FROM = "Rempire pood <pood@rempireshop.com>";
    process.env.MAIL_REPLY_TO = "renat@rempire.ee";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMail(LETTER);

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.from).toBe("Rempire pood <pood@rempireshop.com>");
    expect(body.reply_to).toBe("renat@rempire.ee");
    expect(fromAddress()).toBe("Rempire pood <pood@rempireshop.com>");
    expect(replyToAddress()).toBe("renat@rempire.ee");
  });

  it("passes an idempotency key through as a header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMail({ ...LETTER, idempotencyKey: "confirmed:R-100042" });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("confirmed:R-100042");
  });

  it("retries once on a 5xx and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: "upstream" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "msg_2" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail(LETTER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ ok: true, id: "msg_2", retried: true });
  });

  it("retries once on a network error and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(200, { id: "msg_3" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail(LETTER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    expect(res.retried).toBe(true);
  });

  it("gives up after the second 5xx without throwing", async () => {
    // a fresh Response per call — a body can only be read once
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(500, { message: "boom" })));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail(LETTER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBeUndefined();
    expect(res.status).toBe(500);
    expect(res.error).toBe("boom");
  });

  it("does NOT retry a 4xx — a bad address will stay bad", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { message: "invalid to" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail(LETTER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, status: 422, retried: false });
  });

  it("skips, without calling fetch, when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail(LETTER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, skipped: true, error: "no_api_key" });
  });

  it("skips when there is no valid recipient", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const to of ["", "   ", "not-an-email", [] as string[]]) {
      const res = await sendMail({ ...LETTER, to });
      expect(res).toEqual({ ok: false, skipped: true, error: "no_recipient" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an empty body rather than sending a blank letter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMail({ to: LETTER.to, subject: "x" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.skipped).toBe(true);
    expect(res.error).toBe("empty_body");
  });

  it("de-duplicates recipients and drops the invalid ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMail({
      ...LETTER,
      to: ["a@b.ee", "a@b.ee", "nope", " c@d.ee "],
    });

    expect(bodyOf(fetchMock.mock.calls[0]).to).toEqual(["a@b.ee", "c@d.ee"]);
  });

  it("sanitises tags to the charset Resend accepts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMail({ ...LETTER, tags: { "тег ": "заказ принят", ok: "v-1" } });

    expect(bodyOf(fetchMock.mock.calls[0]).tags).toEqual([
      { name: "____", value: "____________" },
      { name: "ok", value: "v-1" },
    ]);
  });

  it("never throws, whatever fetch does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("the network is on fire")),
    );
    await expect(sendMail(LETTER)).resolves.toMatchObject({ ok: false });
  });
});
