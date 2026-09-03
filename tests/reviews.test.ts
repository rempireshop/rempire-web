import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec } from "@/lib/db";
import {
  addReview,
  approvedReviews,
  listReviews,
  MIN_TEXT,
  ratingFor,
  reviewCounts,
  setReviewStatus,
  validateReview,
  type ReviewInput,
} from "@/lib/reviews";
import { setupDb, teardownDb } from "./helpers";

const GOOD: ReviewInput = {
  product: "handmade-soap-666",
  name: "Андрей",
  rating: 5,
  text: "Беру третий раз, пенится хорошо и запах не бьёт в нос.",
  lang: "RU",
  consent: true,
};

function ok(input: ReviewInput) {
  const res = validateReview(input);
  if (!res.ok) throw new Error("expected valid, got " + res.error);
  return res;
}

describe("review validation", () => {
  it("accepts an ordinary review", () => {
    const res = ok(GOOD);
    expect(res.value).toEqual({
      productId: "handmade-soap-666",
      name: "Андрей",
      rating: 5,
      text: GOOD.text,
      lang: "RU",
    });
  });

  it("silently fails a filled honeypot before anything else", () => {
    // the honeypot wins even when the rest of the form is broken too
    expect(validateReview({ ...GOOD, website: "http://spam.example", rating: 99 }))
      .toEqual({ ok: false, error: "bot" });
  });

  it("needs a product id that looks like one", () => {
    expect(validateReview({ ...GOOD, product: "" })).toEqual({ ok: false, error: "no_product" });
    expect(validateReview({ ...GOOD, product: "не товар" })).toEqual({ ok: false, error: "no_product" });
    expect(validateReview({ ...GOOD, product: "../etc/passwd" })).toEqual({ ok: false, error: "no_product" });
  });

  it("needs a name", () => {
    expect(validateReview({ ...GOOD, name: " " })).toEqual({ ok: false, error: "no_name" });
    expect(validateReview({ ...GOOD, name: "A" })).toEqual({ ok: false, error: "no_name" });
  });

  it("needs a rating of 1–5", () => {
    for (const r of [0, 6, -1, "нет", null, undefined, NaN]) {
      expect(validateReview({ ...GOOD, rating: r })).toEqual({ ok: false, error: "bad_rating" });
    }
    for (const r of [1, 2, 3, 4, 5, "4"]) expect(validateReview({ ...GOOD, rating: r }).ok).toBe(true);
  });

  it("needs at least " + MIN_TEXT + " characters and no more than 1500", () => {
    expect(validateReview({ ...GOOD, text: "Норм" })).toEqual({ ok: false, error: "short_text" });
    expect(validateReview({ ...GOOD, text: "x".repeat(MIN_TEXT - 1) })).toEqual({ ok: false, error: "short_text" });
    expect(validateReview({ ...GOOD, text: "x".repeat(MIN_TEXT) }).ok).toBe(true);
    expect(validateReview({ ...GOOD, text: "y".repeat(1501) })).toEqual({ ok: false, error: "long_text" });
  });

  it("needs the consent box", () => {
    expect(validateReview({ ...GOOD, consent: false })).toEqual({ ok: false, error: "no_consent" });
    expect(validateReview({ ...GOOD, consent: undefined })).toEqual({ ok: false, error: "no_consent" });
    expect(validateReview({ ...GOOD, consent: "true" }).ok).toBe(true);
  });

  it("rejects links, e-mails and handles", () => {
    for (const text of [
      "Отличное мыло, пишите на https://spam.example за скидкой ещё",
      "Хорошее средство, заказывал на cheap-shop.ru в прошлом месяце",
      "Пишите мне на seller@example.com — продам дешевле, честное слово",
      "Всё супер, подписывайтесь на t.me/spamchannel там больше скидок",
      "Отличная штука, мой инстаграм @bestsellershop заходите за скидками",
    ]) {
      expect(validateReview({ ...GOOD, text }), text).toEqual({ ok: false, error: "links" });
    }
  });

  it("rejects obvious profanity in three languages", () => {
    for (const text of [
      "Полная хуйня, деньги на ветер и запах отвратительный совсем",
      "This is absolute shit, do not waste your money on it at all",
      "Täiesti perse toode, ärge raisake oma raha selle peale üldse",
    ]) {
      expect(validateReview({ ...GOOD, text }), text).toEqual({ ok: false, error: "profanity" });
    }
  });

  it("does not catch an innocent word that merely contains a stem", () => {
    // «скипидар» must not trip the «пид» family, «Shitake» must not trip «shit»
    expect(validateReview({ ...GOOD, text: "Пахнет скипидаром, но волосы после него мягкие" }).ok).toBe(true);
    expect(validateReview({ ...GOOD, text: "Smells of shiitake mushrooms somehow, but works well" }).ok).toBe(true);
  });

  it("normalises whitespace, trims and falls back to RU for an unknown language", () => {
    const res = ok({ ...GOOD, name: "  Иван \n Петров ", lang: "de" });
    expect(res.value.name).toBe("Иван Петров");
    expect(res.value.lang).toBe("RU");
    expect(ok({ ...GOOD, lang: "et" }).value.lang).toBe("ET");
  });
});

describe("review storage and moderation", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("021_reviews.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate reviews restart identity");
  });

  it("stores a review as pending and hides it until approved", async () => {
    const saved = await addReview(ok(GOOD).value, "hash");
    expect(saved.status).toBe("pending");
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(await approvedReviews("handmade-soap-666")).toEqual([]);
    expect(await ratingFor("handmade-soap-666")).toEqual({ avg: 0, n: 0 });

    await setReviewStatus(saved.id, "approved", "renat");
    const shown = await approvedReviews("handmade-soap-666");
    expect(shown).toHaveLength(1);
    expect(shown[0].name).toBe("Андрей");
    expect(await ratingFor("handmade-soap-666")).toEqual({ avg: 5, n: 1 });
  });

  it("keeps a rejected review out of the shop", async () => {
    const saved = await addReview(ok(GOOD).value);
    await setReviewStatus(saved.id, "rejected");
    expect(await approvedReviews("handmade-soap-666")).toEqual([]);
    expect((await listReviews("rejected"))[0].id).toBe(saved.id);
  });

  it("averages only the approved ones, per product", async () => {
    const five = await addReview(ok(GOOD).value);
    const three = await addReview(ok({ ...GOOD, rating: 3 }).value);
    const other = await addReview(ok({ ...GOOD, product: "handmade-soap-rule-nr-1", rating: 1 }).value);
    await setReviewStatus(five.id, "approved");
    await setReviewStatus(three.id, "approved");
    await setReviewStatus(other.id, "approved");

    expect(await ratingFor("handmade-soap-666")).toEqual({ avg: 4, n: 2 });
    expect(await ratingFor("handmade-soap-rule-nr-1")).toEqual({ avg: 1, n: 1 });
  });

  it("counts the moderation queue by status", async () => {
    const a = await addReview(ok(GOOD).value);
    await addReview(ok({ ...GOOD, name: "Мария" }).value);
    await setReviewStatus(a.id, "approved");

    expect(await reviewCounts()).toEqual({ pending: 1, approved: 1, rejected: 0 });
    expect(await listReviews("pending")).toHaveLength(1);
    expect(await listReviews()).toHaveLength(2);
  });

  it("returns null when the id is not there", async () => {
    expect(await setReviewStatus("00000000-0000-0000-0000-000000000000", "approved")).toBe(null);
  });
});
