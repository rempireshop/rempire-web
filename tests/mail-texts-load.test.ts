/**
 * loadMailTexts() writes a PROCESS-GLOBAL the letter renderers read, and it is
 * called on every anonymous request to the mail-preview route as well as by the
 * senders of real letters. It used to answer a failed settings read with
 * setMailTextsOverride(null) — so a preview landing on the same instance as a
 * letter being rendered could drop the owner's own subject and intro and hand
 * the customer the built-in defaults instead (audit).
 *
 * No mocks and no database here on purpose: without setupDb() there is no
 * `settings` table, so getSettings() throws for real and this exercises exactly
 * the catch branch the preview route reaches.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mailText, mailTextsOverride, setMailTextsOverride } from "@/emails/texts";
import { loadMailTexts } from "@/lib/mail-texts";

const OWN = { "order-confirmed": { ru: { subject: "Заказ у нас — REMPIRE" } } };

afterEach(() => setMailTextsOverride(null));

describe("loadMailTexts when the settings row cannot be read", () => {
  it("keeps the owner's texts instead of falling back to the built-in ones", async () => {
    setMailTextsOverride(OWN);
    expect(mailText("order-confirmed", "ru", "subject")).toBe("Заказ у нас — REMPIRE");

    await loadMailTexts(); // no `settings` table: this throws inside and is caught

    expect(mailTextsOverride()).toEqual(OWN);
    expect(
      mailText("order-confirmed", "ru", "subject"),
      "a failed settings read must not rewrite a letter that is being sent",
    ).toBe("Заказ у нас — REMPIRE");
  });

  it("leaves an instance that never loaded them on the defaults", async () => {
    setMailTextsOverride(null);
    const before = mailText("order-confirmed", "ru", "subject");
    await loadMailTexts();
    expect(mailTextsOverride()).toEqual({});
    expect(mailText("order-confirmed", "ru", "subject")).toBe(before);
  });
});
