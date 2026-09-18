/**
 * Every documented way Montonio says no, and the words the owner gets for it.
 *
 * The strings below are **Montonio's**, copied from its own pages on
 * 18.09.2026 and not from anything this codebase produces — which is the whole
 * point. The shipping webhook handler was broken for months because its test
 * fixture was written to match the code instead of the documented payload, and
 * a green suite proved nothing (docs/montonio-shipping-audit.md § 1.1). So
 * where the docs print a sentence, that sentence is the input here.
 *
 *   · the five refusals of POST /refunds —
 *     https://docs.montonio.com/api/stargate/guides/refunds
 *   · the seven `refundStatusDescription` values — same page
 *   · `registrationFailed` and «an incorrect receiver phone number» —
 *     https://docs.montonio.com/api/shipping-v2/guides/shipments
 */
import { describe, expect, it } from "vitest";
import {
  MONTONIO_LANGS,
  eur,
  montonioReadinessRows,
  pickLang,
  readRefundRefusal,
  readRefundStatusDescription,
  readShipmentRefusal,
  refundPendingText,
  shipmentRegistrationFailed,
  splitMontonioDetail,
  type RefundRefusal,
  type Trilingual,
} from "@/lib/montonio-problems";
import { montonioErrorText } from "@/lib/payments/montonio";

const ORDER_UUID = "4a9115b7-8e55-48f4-bd7e-febc2402e8a0";

/**
 * The five, verbatim from «Some exceptions that can be thrown by the API»,
 * each paired with the reason the owner must act on. The sixth row is ours:
 * the same message with `[0]` instead of a real figure, which is a completely
 * different problem — nothing has settled yet, or refunds are not switched on —
 * and Montonio hands us the number for free.
 */
const DOCUMENTED: Array<[number, string, RefundRefusal]> = [
  [400, `Order uuid [${ORDER_UUID}] already has a refund with same idempotency key`, "duplicate_key"],
  [400, "Refund amount [1000] exceeds the total amount refundable [10]", "exceeds_refundable"],
  [400, "Refund amount [30] exceeds the total amount refundable [0]", "nothing_refundable"],
  [400, "amount is under the min allowed amount: 0.05EUR", "below_minimum"],
  [401, "STORE_NOT_FOUND - double check your access key", "bad_access_key"],
  [403, "INVALID_TOKEN - double check your secret key", "bad_secret_key"],
];

/** Every language present, non-empty, and long enough to say something. */
function speaksAllThree(m: Trilingual): void {
  for (const lang of MONTONIO_LANGS) {
    expect(typeof m[lang], lang).toBe("string");
    expect(m[lang].trim().length, `${lang}: ${m[lang]}`).toBeGreaterThan(20);
  }
  // …and they are genuinely three, not one string copied three times
  expect(new Set([m.RU, m.ET, m.EN]).size).toBe(3);
}

describe("splitMontonioDetail — the status and the message travel together", () => {
  it("takes montonioErrorText() apart again", () => {
    const detail = montonioErrorText(400, JSON.stringify({ message: "Refund amount [30] exceeds the total amount refundable [0]" }));
    expect(splitMontonioDetail(detail)).toEqual({
      status: 400,
      message: "Refund amount [30] exceeds the total amount refundable [0]",
    });
  });

  it("survives a detail that was never shaped that way", () => {
    expect(splitMontonioDetail("something else entirely")).toEqual({ status: 0, message: "something else entirely" });
    expect(splitMontonioDetail(undefined)).toEqual({ status: 0, message: "" });
  });
});

describe("readRefundRefusal — each documented refusal gets its own words", () => {
  for (const [status, message, reason] of DOCUMENTED) {
    it(`${status} · ${message.slice(0, 44)}… → ${reason}`, () => {
      const detail = montonioErrorText(status, JSON.stringify({ message }));
      const read = readRefundRefusal(detail);
      expect(read.reason).toBe(reason);
      speaksAllThree(read.messages);
    });
  }

  it("gives the six reasons six different Russian sentences", () => {
    const said = DOCUMENTED.map(([status, message]) =>
      readRefundRefusal(montonioErrorText(status, JSON.stringify({ message }))).messages.RU,
    );
    expect(new Set(said).size).toBe(DOCUMENTED.length);
  });

  it("never blames the balance — the one cause that cannot produce a refusal", () => {
    /* The sentence this whole file exists to delete. A refund with no money
       behind it is answered 200 PENDING; it has never been an HTTP error, so
       no refusal may send the owner to look at his balance. */
    for (const [status, message] of DOCUMENTED) {
      const read = readRefundRefusal(montonioErrorText(status, JSON.stringify({ message })));
      for (const lang of MONTONIO_LANGS) {
        expect(read.messages[lang].toLowerCase()).not.toMatch(/проверьте баланс|check the balance|kontrollige (oma )?saldot/);
      }
    }
  });

  it("names the figures Montonio printed in brackets", () => {
    const read = readRefundRefusal(
      montonioErrorText(400, JSON.stringify({ message: "Refund amount [1000] exceeds the total amount refundable [10]" })),
    );
    expect(read.asked).toBe(1000);
    expect(read.refundable).toBe(10);
    expect(read.messages.RU).toContain(eur(10));
    expect(read.messages.EN).toContain("10 €");
  });

  it("tells «нечего возвращать» from «просите меньше», because they need different things", () => {
    const zero = readRefundRefusal(
      montonioErrorText(400, JSON.stringify({ message: "Refund amount [30] exceeds the total amount refundable [0]" })),
    );
    const some = readRefundRefusal(
      montonioErrorText(400, JSON.stringify({ message: "Refund amount [1000] exceeds the total amount refundable [10]" })),
    );
    expect(zero.reason).toBe("nothing_refundable");
    expect(some.reason).toBe("exceeds_refundable");
    // the zero case is the one that must name both Montonio-side preconditions
    expect(zero.messages.RU).toContain("Refundable bank payments");
    expect(zero.messages.RU).toMatch(/рабочий день/);
    expect(zero.messages.ET).toContain("Refundable bank payments");
    expect(zero.messages.EN).toContain("Refundable bank payments");
  });

  it("reads the duplicate key as «первая попытка прошла», not as a failure", () => {
    const read = readRefundRefusal(
      montonioErrorText(400, JSON.stringify({ message: `Order uuid [${ORDER_UUID}] already has a refund with same idempotency key` })),
    );
    expect(read.reason).toBe("duplicate_key");
    expect(read.messages.RU).toMatch(/уже принят|не нажимайте/i);
    expect(read.messages.EN).toMatch(/already accepted/i);
  });

  it("classifies 401 and 403 even when the body says nothing at all", () => {
    expect(readRefundRefusal("HTTP 401").reason).toBe("bad_access_key");
    expect(readRefundRefusal("HTTP 403").reason).toBe("bad_secret_key");
  });

  it("quotes Montonio for a refusal nobody has taught it", () => {
    const detail = montonioErrorText(418, JSON.stringify({ message: "TEAPOT_MODE - the store is a teapot" }));
    const read = readRefundRefusal(detail);
    expect(read.reason).toBe("unknown");
    /* The rule the whole module turns on: our own confident sentence is what
       cost the owner a day, so an unrecognised refusal repeats Montonio and
       invents nothing. */
    for (const lang of MONTONIO_LANGS) {
      expect(read.messages[lang]).toContain("TEAPOT_MODE - the store is a teapot");
    }
  });
});

describe("readRefundStatusDescription — the reason that arrives days later", () => {
  /* Verbatim list from the refunds guide § Refund status descriptions. */
  const DESCRIPTIONS = [
    ["INSUFFICIENT_FUNDS", "insufficient_funds"],
    ["REFUND_EXCEEDS_ORDER_PAID_AMOUNT", "exceeds_paid"],
    ["DECLINED", "declined"],
    ["EXPIRED_OR_CANCELLED_CARD", "expired_or_cancelled_card"],
    ["LOST_OR_STOLEN_CARD", "lost_or_stolen_card"],
    ["EXPIRED", "expired"],
    ["OTHER", "other"],
  ] as const;

  for (const [word, reason] of DESCRIPTIONS) {
    it(`${word} → ${reason}, in three languages`, () => {
      const read = readRefundStatusDescription(word);
      expect(read.reason).toBe(reason);
      speaksAllThree(read.messages);
    });
  }

  it("says what INSUFFICIENT_FUNDS actually means for the owner: wait, or top up", () => {
    const read = readRefundStatusDescription("INSUFFICIENT_FUNDS");
    // the ten-day clock is the fact that decides whether to do anything
    expect(read.messages.RU).toContain("10");
    expect(read.messages.ET).toContain("10");
    expect(read.messages.EN).toContain("10");
  });

  it("treats the documented `null` as «нечего объяснять»", () => {
    const read = readRefundStatusDescription(null);
    expect(read.reason).toBe("unknown");
    expect(read.montonio).toBe("");
  });

  it("quotes a description it does not know", () => {
    const read = readRefundStatusDescription("SOME_NEW_WORD");
    expect(read.reason).toBe("unknown");
    expect(read.messages.RU).toContain("SOME_NEW_WORD");
    expect(read.messages.EN).toContain("SOME_NEW_WORD");
  });
});

describe("refundPendingText — a refund that has only started", () => {
  it("counts down Montonio's ten days", () => {
    const fresh = refundPendingText(0);
    speaksAllThree(fresh);
    expect(fresh.RU).toContain("10");
    const day3 = refundPendingText(72);
    expect(day3.RU).toContain("7");
  });

  it("says the money is back with the shop once Montonio has given up", () => {
    const dead = refundPendingText(11 * 24);
    speaksAllThree(dead);
    expect(dead.RU).toMatch(/отменён|остались в магазине/);
    expect(dead.EN).toMatch(/cancelled/i);
  });
});

describe("readShipmentRefusal — a parcel the carrier would not take", () => {
  it("reads the documented common cause: the receiver's phone", () => {
    /* Shipments guide: «A common issue causing this is an incorrect receiver
       phone number.» Sandbox skips phone validation entirely, so this path
       cannot be exercised against Montonio at all — only here. */
    const read = readShipmentRefusal('400 {"message":"receiver.phoneNumber is not valid"}');
    expect(read.reason).toBe("bad_phone");
    speaksAllThree(read.messages);
    expect(read.messages.RU).toMatch(/телефон/i);
  });

  it("reads the dimensions a carrier with parcelDimensionsRequired insists on", () => {
    const read = readShipmentRefusal('400 {"message":"parcels.0.length should not be empty"}');
    expect(read.reason).toBe("dimensions_required");
    speaksAllThree(read.messages);
  });

  it("reads the carrierCode enum 400 Montonio really answers with", () => {
    const read = readShipmentRefusal(
      '400 {"message":"carrierCode must be one of the following values: smartpost, dpd, venipak, omniva, unisend, latvian_post, inpost, orlen, novaPost, postnord"}',
    );
    expect(read.reason).toBe("bad_carrier_code");
    speaksAllThree(read.messages);
  });

  it("falls back to «the carrier said no» for a bare registrationFailed", () => {
    const read = shipmentRegistrationFailed("registrationFailed");
    expect(read.reason).toBe("registration_failed");
    speaksAllThree(read.messages);
    /* Two facts the owner cannot get anywhere else: the parcel exists at
       Montonio (so a second press is pointless) and the fix is a correction
       somebody must send, not a retry. */
    expect(read.messages.RU).toMatch(/второй раз/i);
    expect(read.messages.EN).toMatch(/again does nothing/i);
  });

  it("quotes the carrier for anything it has not been taught", () => {
    const read = readShipmentRefusal('422 {"message":"WAREHOUSE_CLOSED_FOR_HOLIDAY"}');
    expect(read.reason).toBe("unknown");
    for (const lang of MONTONIO_LANGS) expect(read.messages[lang]).toContain("WAREHOUSE_CLOSED_FOR_HOLIDAY");
  });

  it("gives every shipment reason its own Russian sentence", () => {
    const said = [
      readShipmentRefusal('400 {"message":"receiver.phoneNumber is not valid"}'),
      readShipmentRefusal('400 {"message":"parcels.0.length should not be empty"}'),
      readShipmentRefusal('400 {"message":"carrierCode must be one of the following values: omniva"}'),
      readShipmentRefusal('400 {"message":"pickup point not found"}'),
      readShipmentRefusal('400 {"message":"receiver.streetAddress should not be empty"}'),
      readShipmentRefusal("401 STORE_NOT_FOUND"),
      readShipmentRefusal("403 INVALID_TOKEN"),
      shipmentRegistrationFailed("registrationFailed"),
    ].map((r) => r.messages.RU);
    expect(new Set(said).size).toBe(said.length);
  });
});

describe("montonioReadinessRows — telling him before he needs it", () => {
  const base = {
    configured: true,
    env: "live" as const,
    bankPayments: true,
    refundableBankPayments: true,
    carriers: 5,
    webhookRegistered: true,
    pendingRefunds: 0,
    overdueRefunds: 0,
  };

  it("is quiet and green when everything is on", () => {
    const rows = montonioReadinessRows(base);
    expect(rows.map((r) => r.key)).toEqual(["env", "refunds", "ship_webhook"]);
    expect(rows.every((r) => r.ok)).toBe(true);
    for (const row of rows) {
      /* A row title is a couple of words — «Montonio · режим» — so it only has
         to exist in all three; the sentence under it is the one that has to
         say something. */
      for (const lang of MONTONIO_LANGS) expect(row.name[lang].trim().length, lang).toBeGreaterThan(3);
      speaksAllThree(row.sub);
    }
  });

  it("goes red on «Bank payments on, Refundable bank payments off» — the whole point", () => {
    const rows = montonioReadinessRows({ ...base, refundableBankPayments: false });
    const refunds = rows.find((r) => r.key === "refunds")!;
    expect(refunds.ok).toBe(false);
    expect(refunds.quiet).toBeFalsy();
    // it must name the product, because that is what has to be switched on
    for (const lang of MONTONIO_LANGS) expect(refunds.sub[lang]).toContain("Refundable bank payments");
  });

  it("says «пока не знаем» — grey, not red — before the first paid order", () => {
    const rows = montonioReadinessRows({ ...base, refundableBankPayments: null });
    const refunds = rows.find((r) => r.key === "refunds")!;
    /* `null` is not `false`. A shop with no sale yet is not a shop with the
       product switched off, and a red square the owner cannot act on is worse
       than a grey one that tells him to wait. */
    expect(refunds.ok).toBe(true);
    expect(refunds.quiet).toBe(true);
    expect(refunds.sub.RU).toMatch(/пока не знаем/i);
  });

  it("warns that sandbox is not the shop", () => {
    const rows = montonioReadinessRows({ ...base, env: "sandbox" });
    const env = rows.find((r) => r.key === "env")!;
    expect(env.ok).toBe(false);
    expect(env.sub.EN).toMatch(/dummies|not real/i);
  });

  it("names the unregistered parcel webhook, which nothing else can notice", () => {
    const rows = montonioReadinessRows({ ...base, webhookRegistered: false });
    const hook = rows.find((r) => r.key === "ship_webhook")!;
    expect(hook.ok).toBe(false);
    expect(hook.sub.RU).toMatch(/Partner System/);
  });

  it("adds a row only when refunds are actually waiting, and reddens it past ten days", () => {
    expect(montonioReadinessRows(base).some((r) => r.key === "pending_refunds")).toBe(false);

    const waiting = montonioReadinessRows({ ...base, pendingRefunds: 2 }).find((r) => r.key === "pending_refunds")!;
    expect(waiting.ok).toBe(true);
    expect(waiting.sub.RU).toContain("2");

    const dead = montonioReadinessRows({ ...base, pendingRefunds: 3, overdueRefunds: 1 })
      .find((r) => r.key === "pending_refunds")!;
    expect(dead.ok).toBe(false);
    expect(dead.sub.EN).toMatch(/cancelled/i);
  });

  it("says «нет ключей» and nothing else when there are none", () => {
    const rows = montonioReadinessRows({
      configured: false,
      env: null,
      bankPayments: null,
      refundableBankPayments: null,
      carriers: null,
      webhookRegistered: null,
      pendingRefunds: 0,
      overdueRefunds: 0,
    });
    expect(rows.map((r) => r.key)).toEqual(["montonio"]);
    expect(rows[0].ok).toBe(false);
    speaksAllThree(rows[0].sub);
  });
});

describe("the small print", () => {
  it("formats money the way the rest of the shop does", () => {
    expect(eur(10)).toBe("10 €");
    expect(eur(33.09)).toBe("33,09 €");
    expect(eur(0.05)).toBe("0,05 €");
  });

  it("falls back to Russian for a language nobody asked for", () => {
    expect(pickLang("et")).toBe("ET");
    expect(pickLang("EN")).toBe("EN");
    expect(pickLang("de")).toBe("RU");
    expect(pickLang(undefined)).toBe("RU");
  });
});
