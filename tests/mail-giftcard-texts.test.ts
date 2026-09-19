/**
 * The gift-card letter became editable on 19.09.2026, and had to stay the same
 * letter while nobody edits it.
 *
 * Dim asked for it twice in one afternoon. First: «"showing the design" does
 * not give absolutely anything, if anything it would make sense to be able to
 * edit it in emails» — the card's own layout is fixed (src/lib/giftcard-pdf.ts
 * knows one), so the letter around it is the only part he can shape. Then,
 * when a button to that letter appeared: «The gift card email seems to be
 * empty.» It was: `MAIL_TEXT_TEMPLATES` listed twelve letters and this was not
 * one of them, so the editor had no fields to show.
 *
 * Two things are pinned here, and the first matters more than the second:
 *
 *   1. **a shop that edits nothing sends exactly the letter it sent before** —
 *      subject, opening and closing, in all three languages, with and without
 *      a giver;
 *   2. an edit reaches the letter, in its HTML and its plain text alike.
 *
 * The opening sentence is the interesting one. Whether there is a giver at all
 * is DATA — «Мария дарит вам…» against «Вам подарили…» — not wording, so the
 * renderer keeps that branch while the owner has written nothing, and steps
 * aside the moment he has. His sentence then opens the letter in both cases,
 * which is the only rule he can predict.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_LANGS, MAIL_TEXT_TEMPLATES, renderGiftCard, setMailTextsOverride, type Lang } from "@/emails";

const CARD = { code: "rmp-abcd-1234", amount: 50, lang: "ru" };
const GIVEN = { ...CARD, recipient: { name: "Мария", from: "Рената", message: "" } };

/** What the letter said on 18.09.2026, before any of this — per language. */
const BEFORE: Record<Lang, { subject: string; noFrom: string; from: string; signature: string }> = {
  ru: {
    subject: "Вам подарили карту Rempire на 50 €",
    noFrom: "Вам подарили подарочную карту Rempire на 50 €. Ниже её код.",
    from: "Рената дарит вам подарочную карту Rempire на 50 €. Ниже её код.",
    signature: "Храните код как деньги: он не привязан к адресу и работает у любого, кто его введёт.",
  },
  et: {
    subject: "Sulle kingiti Rempire kinkekaart summas 50 €",
    noFrom: "Sulle kingiti Rempire kinkekaart summas 50 €. Kood on allpool.",
    from: "Рената kingib sulle Rempire kinkekaardi summas 50 €. Kood on allpool.",
    signature: "Hoia koodi nagu raha: see ei ole aadressiga seotud ja töötab igaühel, kes selle sisestab.",
  },
  en: {
    subject: "You've been given a 50 € Rempire gift card",
    noFrom: "You've been given a 50 € Rempire gift card. The code is below.",
    from: "Рената is giving you a 50 € Rempire gift card. The code is below.",
    signature: "Treat the code like cash: it is not tied to an address and works for anyone who enters it.",
  },
};

afterEach(() => setMailTextsOverride(null));

describe("the letter is in the set the owner may write", () => {
  it("is listed, so «Письма» has fields to show for it", () => {
    /* The panel's own list mirrors this one. While the two disagreed, the row
       existed and opened on nothing at all. */
    expect(MAIL_TEXT_TEMPLATES as readonly string[]).toContain("gift-card");
  });

  /* …and the two lists have to be the same list. The panel is a static bundle
     that cannot import src/, so «Письма» carries its own copy of the letters
     it offers — and on 19.09.2026 a row was added to that copy for a letter
     the text layer did not know. `mailTpl()` falls back to the FIRST row for a
     key it cannot find, so «Письмо к карте» opened «Заказ принят» and the
     editor beneath it was empty. Neither side can see the other, so this is
     the only place the disagreement can be caught. */
  it("offers exactly the letters the panel does", () => {
    const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
      .replace(/\r\n/g, "\n");
    const at = src.indexOf("var ADM_MAIL_ROWS = [");
    expect(at, "public/shop2/app.js no longer declares ADM_MAIL_ROWS").toBeGreaterThan(-1);
    const end = src.indexOf("\n  ];", at);
    const rows = [...src.slice(at, end).matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]);
    /* The SET, not the order: the panel's order is a product decision — the
       order letters run in the sequence they happen, «Возврат отправлен»
       before «Деньги возвращены» — while this list's order is arbitrary. What
       may never differ is which letters are in it. */
    expect([...rows].sort(), "a letter the panel offers and the text layer does not know, or the reverse")
      .toEqual([...MAIL_TEXT_TEMPLATES].sort());
  });
});

describe("a shop that edits nothing sends the letter it always sent", () => {
  for (const lang of ALL_LANGS) {
    it(`${lang}: subject, opening and closing are word for word`, () => {
      const was = BEFORE[lang];
      const plain = renderGiftCard(CARD, lang);
      expect(plain.subject).toBe(was.subject);
      expect(plain.text).toContain(was.noFrom);
      expect(plain.text).toContain(was.signature);

      /* …and the same letter when somebody is giving it, which is the branch
         that could not survive being turned into one editable sentence. */
      const given = renderGiftCard(GIVEN, lang);
      expect(given.text).toContain(was.from);
      expect(given.text).not.toContain(was.noFrom);
    });
  }

  it("still carries the code, the amount and the how-to", () => {
    const mail = renderGiftCard(CARD, "ru");
    expect(mail.text).toContain("RMP-ABCD-1234");
    expect(mail.html).toContain("RMP-ABCD-1234");
    expect(mail.text).toContain("Карта действует год со дня покупки");
  });
});

describe("an edit reaches the letter", () => {
  it("replaces the subject, the opening and the closing", () => {
    setMailTextsOverride({
      "gift-card": {
        ru: {
          subject: "Подарок от Rempire на {total}",
          intro: "Это подарочная карта на {total}. Код — {code}.",
          signature: "Вопросы — пишите нам.",
        },
      },
    } as never);

    const mail = renderGiftCard(CARD, "ru");
    expect(mail.subject).toBe("Подарок от Rempire на 50 €");
    expect(mail.text).toContain("Это подарочная карта на 50 €. Код — RMP-ABCD-1234.");
    expect(mail.text).toContain("Вопросы — пишите нам.");
    expect(mail.html).toContain("Вопросы");
    // the sentence it replaced is gone, not merely joined
    expect(mail.text).not.toContain(BEFORE.ru.noFrom);
    expect(mail.text).not.toContain(BEFORE.ru.signature);
  });

  it("his opening wins even when there is a giver", () => {
    setMailTextsOverride({ "gift-card": { ru: { intro: "Карта на {total} внутри." } } } as never);
    const mail = renderGiftCard(GIVEN, "ru");
    expect(mail.text).toContain("Карта на 50 € внутри.");
    expect(mail.text).not.toContain(BEFORE.ru.from);
    /* The greeting is not his to write — the panel says so under the box —
       and it is still there with the name in it. */
    expect(mail.text).toContain("Здравствуйте, Мария!");
  });

  it("leaves the other languages alone", () => {
    setMailTextsOverride({ "gift-card": { ru: { subject: "Только по-русски" } } } as never);
    expect(renderGiftCard(CARD, "ru").subject).toBe("Только по-русски");
    expect(renderGiftCard(CARD, "en").subject).toBe(BEFORE.en.subject);
    expect(renderGiftCard(CARD, "et").subject).toBe(BEFORE.et.subject);
  });

  it("an empty box is not an edit — it falls back rather than sending nothing", () => {
    setMailTextsOverride({ "gift-card": { ru: { subject: "   ", intro: "" } } } as never);
    const mail = renderGiftCard(CARD, "ru");
    expect(mail.subject).toBe(BEFORE.ru.subject);
    expect(mail.text).toContain(BEFORE.ru.noFrom);
  });
});
