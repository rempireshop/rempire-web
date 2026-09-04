/**
 * `settings.mail_texts` — the three strings per letter the owner may rewrite.
 *
 * Four things are worth a test here, in the order of how badly each bites:
 *   · the fallback — a shop that never opened «Письма» must render exactly
 *     what it rendered before the editor existed;
 *   · the substitution — a letter that prints "{order}" to a customer, or
 *     silently eats a curly brace out of a sentence, is worse than no editor;
 *   · the escaping — the owner types text, never markup, and the panel is one
 *     prompt-injected assistant action away from being handed markup;
 *   · the sanitiser on PUT /api/admin/settings, which is the first door
 *     (unknown letters, unknown languages, control characters, length).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import {
  MAIL_TEXT_LIMITS,
  MAIL_TEXT_TEMPLATES,
  cleanMailTexts,
  defaultMailText,
  fillPlaceholders,
  mailText,
  mailTextHtml,
  setMailTextsOverride,
} from "@/emails/texts";
import { ALL_LANGS, renderDemo, renderOrderConfirmed } from "@/emails";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";

afterEach(() => setMailTextsOverride(null));

/* ---------- defaults ---------------------------------------------------- */

describe("no override = the letter's own copy", () => {
  beforeEach(() => setMailTextsOverride(null));

  it("every template and language has all three defaults", () => {
    for (const template of MAIL_TEXT_TEMPLATES) {
      for (const lang of ALL_LANGS) {
        for (const field of ["subject", "intro", "signature"] as const) {
          const v = defaultMailText(template, lang, field);
          expect(v.length, `${template}/${lang}/${field} is empty`).toBeGreaterThan(5);
          expect(v.length).toBeLessThanOrEqual(MAIL_TEXT_LIMITS[field]);
        }
      }
    }
  });

  it("mailText() falls back to the default for an empty override", () => {
    setMailTextsOverride({});
    expect(mailText("order-confirmed", "ru", "subject", { order: "R-1" })).toBe(
      "Заказ R-1 принят — Rempire",
    );
    setMailTextsOverride({ "order-confirmed": { et: { intro: "" } } });
    expect(mailText("order-confirmed", "et", "intro", { order: "R-1" })).toBe(
      defaultMailText("order-confirmed", "et", "intro").replace("{order}", "R-1"),
    );
  });

  it("a blank override leaves the rendered letter untouched", () => {
    const before = renderDemo("order-confirmed", "et");
    setMailTextsOverride({ birthday: { en: { subject: "irrelevant" } } });
    const after = renderDemo("order-confirmed", "et");
    expect(after.subject).toBe(before.subject);
    expect(after.html).toBe(before.html);
  });

  it("the closing line of every letter is still the one it shipped with", () => {
    expect(renderDemo("order-confirmed", "ru").text).toContain("Просто ответьте на это письмо");
    expect(renderDemo("order-shipped", "ru").text).toContain("Трек-номер начинает отслеживаться");
    expect(renderDemo("login-code", "en").text).toContain("Did not ask for a code?");
  });
});

/* ---------- substitution ------------------------------------------------ */

describe("placeholders", () => {
  it("fills the documented tokens and leaves everything else literal", () => {
    const out = fillPlaceholders("{name}, {order}, {total} · {nope} { name } {NAME} {", {
      name: "Renat",
      order: "R-100042",
      total: "95 €",
    });
    expect(out).toBe("Renat, R-100042, 95 € · {nope} { name } {NAME} {");
  });

  it("an unknown value becomes an empty string, never the word undefined", () => {
    expect(fillPlaceholders("[{track}]", {})).toBe("[]");
    expect(fillPlaceholders("[{track}]", { track: undefined })).toBe("[]");
  });

  it("the owner's own subject sees the order number", () => {
    setMailTextsOverride({
      "order-confirmed": { ru: { subject: "{shop}: заказ {order} на {total}" } },
    });
    const mail = renderOrderConfirmed(
      { number: "R-100055", total: 77.9, items: [] },
      "ru",
    );
    expect(mail.subject).toBe("Rempire: заказ R-100055 на 77,90 €");
  });

  it("reaches the intro and the closing line in both HTML and plain text", () => {
    setMailTextsOverride({
      "order-shipped": {
        et: { intro: "Pakk {order} teel, kood {track}.", signature: "Tänu, {shop}!" },
      },
    });
    const mail = renderDemo("order-shipped", "et");
    expect(mail.html).toContain("Pakk R-100042 teel, kood CE123456789EE.");
    expect(mail.text).toContain("Pakk R-100042 teel, kood CE123456789EE.");
    expect(mail.html).toContain("Tänu, Rempire!");
    expect(mail.text).toContain("Tänu, Rempire!");
  });

  it("the birthday letter's discount stays live in the default text", async () => {
    setMailTextsOverride(null);
    const { renderBirthday } = await import("@/emails/birthday");
    expect(renderBirthday({ name: "Renat" }, "ru", "X", { percent: 25 }).html).toContain("25 %");
    // and the owner who keeps {percent} in his own wording keeps it live too
    setMailTextsOverride({ birthday: { ru: { intro: "Скидка {percent} % для вас." } } });
    expect(renderBirthday({ name: "Renat" }, "ru", "X", { percent: 30 }).html).toContain(
      "Скидка 30 % для вас.",
    );
  });
});

/* ---------- escaping ---------------------------------------------------- */

describe("owner text is text, not markup", () => {
  it("escapes <b>x</b> in a subject", () => {
    setMailTextsOverride({ "order-confirmed": { ru: { subject: "<b>x</b> — Rempire" } } });
    const mail = renderDemo("order-confirmed", "ru");
    // the subject is a mail header, not HTML — it stays exactly as typed
    expect(mail.subject).toBe("<b>x</b> — Rempire");
    // and it never becomes live markup in the body
    expect(mail.html).not.toContain("<b>x</b>");
  });

  it("escapes markup in the intro and the closing line", () => {
    setMailTextsOverride({
      "abandoned-cart": {
        en: {
          intro: '<script>alert(1)</script> & "quoted"',
          signature: "<img src=x onerror=alert(1)>",
        },
      },
    });
    const mail = renderDemo("abandoned-cart", "en");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).toContain("&amp;");
    expect(mail.html).toContain("&quot;quoted&quot;");
  });

  it("mailTextHtml turns a newline into a line break, not into markup", () => {
    setMailTextsOverride({ "back-in-stock": { ru: { intro: "Первая\nвторая" } } });
    expect(mailTextHtml("back-in-stock", "ru", "intro")).toBe("Первая<br>вторая");
    expect(mailText("back-in-stock", "ru", "intro")).toBe("Первая\nвторая");
  });
});

/* ---------- the sanitiser ----------------------------------------------- */

describe("cleanMailTexts", () => {
  it("keeps a well-formed blob and nothing else", () => {
    expect(
      cleanMailTexts({
        "order-confirmed": { et: { subject: "Tellimus {order}", intro: "Tere." } },
        "made-up-letter": { et: { subject: "no" } },
        "order-shipped": { fr: { subject: "non" }, ru: { colour: "no", subject: "Да" } },
      }),
    ).toEqual({
      "order-confirmed": { et: { subject: "Tellimus {order}", intro: "Tere." } },
      "order-shipped": { ru: { subject: "Да" } },
    });
  });

  it("drops empties, arrays, nulls and non-strings", () => {
    expect(cleanMailTexts(null)).toEqual({});
    expect(cleanMailTexts([1, 2])).toEqual({});
    expect(cleanMailTexts("not json")).toEqual({});
    expect(cleanMailTexts({ birthday: [] })).toEqual({});
    expect(cleanMailTexts({ birthday: { ru: { subject: "   " } } })).toEqual({});
    expect(cleanMailTexts({ birthday: { ru: { subject: 42 } } })).toEqual({});
  });

  it("accepts the jsonb string form a hand-written row can carry", () => {
    expect(cleanMailTexts(JSON.stringify({ birthday: { ru: { subject: "Ура" } } }))).toEqual({
      birthday: { ru: { subject: "Ура" } },
    });
  });

  it("strips control characters and collapses a subject onto one line", () => {
    const out = cleanMailTexts({
      birthday: { ru: { subject: "A B\nC", intro: "one\n\n\n\ntwo", signature: "x\ty" } },
    });
    expect(out.birthday!.ru!.subject).toBe("A B C");
    expect(out.birthday!.ru!.intro).toBe("one\n\ntwo");
    expect(out.birthday!.ru!.signature).toBe("x y");
  });

  it("clamps to 200 / 1500 / 300", () => {
    const out = cleanMailTexts({
      birthday: {
        ru: { subject: "s".repeat(500), intro: "i".repeat(4000), signature: "g".repeat(900) },
      },
    })!.birthday!.ru!;
    expect(out.subject!.length).toBe(MAIL_TEXT_LIMITS.subject);
    expect(out.intro!.length).toBe(MAIL_TEXT_LIMITS.intro);
    expect(out.signature!.length).toBe(MAIL_TEXT_LIMITS.signature);
  });

  it("a clamped string can still never reach a letter as markup", () => {
    setMailTextsOverride(cleanMailTexts({ birthday: { ru: { subject: "<b>x</b>" } } }));
    expect(mailText("birthday", "ru", "subject")).toBe("<b>x</b>");
    expect(mailTextHtml("birthday", "ru", "subject")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});

/* ---------- the route --------------------------------------------------- */

describe("PUT /api/admin/settings validates mail_texts", () => {
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
    setMailTextsOverride(null);
  });

  async function put(value: unknown) {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const res = await PUT(
      new Request(`${ORIGIN}/api/admin/settings/`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ mail_texts: value }),
      }),
    );
    expect(res.status).toBe(200);
    return (await res.json()).settings.mail_texts;
  }

  it("stores only known letters, languages and fields", async () => {
    const stored = await put({
      "order-confirmed": { et: { subject: " Uus teema ", nope: "x" } },
      "gift-card": { et: { subject: "not editable" } },
      "order-shipped": { xx: { subject: "no such language" } },
    });
    expect(stored).toEqual({ "order-confirmed": { et: { subject: "Uus teema" } } });
  });

  it("clamps and de-controls before anything is written", async () => {
    const stored = await put({
      birthday: { ru: { subject: "x".repeat(1000), signature: "ab" } },
    });
    expect(stored.birthday.ru.subject.length).toBe(MAIL_TEXT_LIMITS.subject);
    expect(stored.birthday.ru.signature).toBe("a b");
  });

  it("a garbage value stores an empty map, never the garbage", async () => {
    expect(await put("drop table settings")).toEqual({});
    expect(await put([{ subject: "x" }])).toEqual({});
  });

  it("the loader hands the stored texts to the renderers", async () => {
    await put({ "order-confirmed": { et: { subject: "Kiri {order} — Rempire" } } });
    const { loadMailTexts } = await import("@/lib/mail-texts");
    await loadMailTexts();
    expect(renderDemo("order-confirmed", "et").subject).toBe("Kiri R-100042 — Rempire");
    // and «вернуть стандартный текст» — an empty map — puts the default back
    await put({});
    await loadMailTexts();
    expect(renderDemo("order-confirmed", "et").subject).toBe(
      "Tellimus R-100042 on vastu võetud — Rempire",
    );
  });
});
