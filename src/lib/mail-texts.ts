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
    /* Deliberately NOT setMailTextsOverride(null).
       The override is one process-global that every renderer in the instance
       reads, and this function is called by the UNAUTHENTICATED preview route
       on every anonymous request (src/app/api/admin/mail/preview) as well as by
       the real senders. Clearing it on a failed settings read meant a preview
       landing on the same instance as a letter being rendered could swap the
       owner's own subject and intro for the built-in defaults, in a letter that
       was already on its way to a customer (audit).
       A setting that cannot be read is no reason to forget one that was read:
       the previous value stays, and an instance that never managed to read it
       still holds {} here, which is the defaults. */
    console.warn("[mail-texts] letter texts unavailable, keeping the ones already loaded", err);
  }
}
