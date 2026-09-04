/**
 * The one door between `settings.mail_texts` and the letter renderers.
 *
 * `src/emails/*` is deliberately database-free — a letter rendered in a test
 * or in the preview route must not drag `pg` in behind it — so the owner's
 * copy is loaded here and dropped into the ambient override the renderers
 * read (`setMailTextsOverride`, the same shape `setBrandOverride` uses for
 * the footer details).
 *
 * Every caller that renders a real letter calls this first:
 *   · src/lib/mail-hooks.ts       — order-confirmed / order-shipped
 *   · src/lib/flows.ts            — abandoned-cart / back-in-stock / birthday
 *   · src/app/api/account/code    — login-code
 *   · src/app/api/admin/mail/*    — the preview iframe and the test send
 *
 * That last one is the point: the preview is not a separate renderer with its
 * own copy of the texts, it is the same function reading the same setting, so
 * what the owner sees in «Письма» is what the customer gets.
 *
 * Best effort, like loadBrand(): no database, an empty row or a malformed one
 * all end with the built-in defaults, never an exception. A paid order must
 * not fail because a settings query did.
 */

import { cleanMailTexts, setMailTextsOverride } from "@/emails/texts";

export async function loadMailTexts(): Promise<void> {
  try {
    const { getSettings } = await import("@/lib/orders");
    setMailTextsOverride(cleanMailTexts((await getSettings()).mail_texts));
  } catch (err) {
    console.warn("[mail-texts] letter texts unavailable, using defaults", err);
    setMailTextsOverride(null);
  }
}
