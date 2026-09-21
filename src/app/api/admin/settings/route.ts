/**
 * PUT /api/admin/settings — shop-wide switches.
 *
 *   { "chatbot": false }
 *   { "flows": { "abandoned": true, "birthday": false, "backstock": true } }
 *   { "settings": { "shipping": { "freeFrom": 59 } } }
 *
 * Each top-level key becomes one row in `settings`; the value is stored as
 * jsonb exactly as sent. GET returns the whole map (admin only — the public
 * copy lives at /api/overrides).
 */
import { requireAdmin } from "@/lib/auth";
import { getSettings, setSetting, writeAuditSafe } from "@/lib/orders";
import { cleanPricing } from "@/lib/loyalty";
import { belowCostCells, belowCostMessage, cleanShippingRules, type ShippingRules } from "@/lib/shipping";
import { cleanMailTexts } from "@/emails/texts";
import { cleanMailBudget } from "@/lib/mail-budget";
import { cleanGiftAmounts } from "@/lib/giftcards";
import { cleanInvoiceSettings } from "@/lib/invoices";
import { cleanDelivery } from "@/lib/delivery";
import { mergeParcel } from "@/lib/shipping/parcel";
import { cleanBankFilter } from "@/lib/payments/methods";
import { stampUnpaidFloor } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^[a-z0-9_.-]{1,64}$/i;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, settings: await getSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/settings] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* The biggest thing this route ever legitimately carries is the shop's own
     content document (hero slides, the contact page, the mail texts in three
     languages) — tens of kilobytes. Nothing capped the request, and a key
     outside the five validated ones is stored as raw jsonb AND written a
     second time into admin_audit, so one request could persist twice its own
     size for good. Same cap and the same code as the other admin writers. */
  const MAX_BYTES = 256_000;
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  // {key, value} · {settings:{…}} · a flat map — all mean the same thing here.
  let entries: Array<[string, unknown]>;
  if (typeof body.key === "string" && "value" in body) entries = [[body.key, body.value]];
  else if (body.settings && typeof body.settings === "object") entries = Object.entries(body.settings as object);
  else entries = Object.entries(body);

  if (!entries.length || entries.length > 50) return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  for (const [key] of entries) {
    if (!KEY_RE.test(key)) return Response.json({ ok: false, error: "bad_key", detail: key }, { status: 400 });
  }

  try {
    for (let [key, value] of entries) {
      // wholesale/loyalty: clamp to sane bounds regardless of who is
      // writing (panel form, demoApply's undo, or the assistant's
      // set_pricing action) — the same "first door, not the only one"
      // reasoning as every other validated setting.
      if (key === "pricing") value = cleanPricing(value);
      // the same parser the checkout reads with — a rule the storefront would
      // ignore (NaN, 1e9, a negative) is normalised here instead of stored raw
      if (key === "shipping_rules") {
        /* cleanShippingRules(), not parseShippingRules(): the same validation
           without the seeds. A cell the owner did not fill must be ABSENT from
           the stored row — that is the only way «пустое поле — цена Montonio»
           survives a save, because a number written down stops following the
           tariff. Reading is unchanged (loadShippingRules still parses with
           the seeds), so nothing about a quote moves. See cleanShippingRules
           in src/lib/shipping.ts for the whole of it. */
        value = cleanShippingRules(value);
        /* …and a price under what Montonio charges for that very delivery is
           refused outright (Ренат, 13.09.2026: «we get prices from Montonio
           and we should use those»). The panel has printed the cost under each
           box and reddened it for weeks; nine of the fourteen carrier-country
           pairs the checkout can produce still went out below cost, with the
           *shopper* choosing which. A red hint is a suggestion, this is the
           rule. The message names the carrier, the country and both numbers,
           so there is nothing to look up. */
        const bad = belowCostCells(value as ShippingRules);
        if (bad.length) {
          return Response.json(
            { ok: false, error: "below_cost", detail: belowCostMessage(bad), cells: bad },
            { status: 400 },
          );
        }
      }
      /* «Письма»: the owner's subject / intro / signature per letter and
         language. Unknown template or language keys are dropped, control
         characters stripped and every string clamped (200/1500/300) before
         anything is stored — src/emails/texts.ts cleanMailTexts(). The
         letters escape it again at render time; this is the first door. */
      if (key === "mail_texts") value = cleanMailTexts(value);
      /* «Лимит писем»: how many letters a day the shop allows itself and how
         many of them are held back for order letters — the numbers
         src/lib/mail-budget.ts stops the campaigns with. Whole, non-negative,
         and a reserve that can never exceed the cap it lives inside, because
         the arithmetic behind «рассылке доступно M» must not be able to go
         negative. Same first door as pricing and gift_amounts. */
      if (key === "mail_budget") value = cleanMailBudget(value);
      /* «Подарочные карты»: which denominations the /gift/ page offers. Kept to
         a subset of the amounts the checkout will actually accept
         (GIFT_AMOUNTS), sorted and de-duplicated, and never empty — a gift page
         with no button on it is a page that cannot sell. Same "first door, not
         the only one" reasoning as pricing and shipping_rules above. */
      if (key === "gift_amounts") value = cleanGiftAmounts(value);
      /* «Счета для компаний»: the number prefix (letters, digits, dashes) and
         the payment term (1–60 days) — src/lib/invoices.ts. Same first door. */
      if (key === "invoice") value = cleanInvoiceSettings(value);
      /* «Доставлен» closing itself: how many days after «Отправлен» an order
         nobody closed is closed anyway (0 = never), and whether the carrier's
         own status may close it — src/lib/delivery.ts. Same first door. */
      if (key === "delivery") value = cleanDelivery(value);
      /* «Коробка магазина»: the one carton the shop declares when Montonio
         asks for dimensions, plus the locker door to pre-select. Clamped to a
         real box (1–200 cm) and to Montonio's own five sizes before anything
         is stored — src/lib/shipping/parcel.ts. `recent` is the panel's
         read-only half: it is written by the label route, not by a form, so a
         save that does not mention it keeps what is stored rather than
         erasing the very history the suggestion is learned from. Same first
         door. */
      if (key === "shipping_parcel") value = await mergeParcel(value);
      /* «Какие банки показывать»: the bank codes the checkout may draw as
         chips. Montonio offers no way to shorten its own list, so the list is
         shortened here — an array of its codes, uppercased, de-duplicated and
         capped (src/lib/payments/methods.ts cleanBankFilter). Empty means
         «показывать все», which is what a shop that never opened this setting
         has. Same first door as pricing and gift_amounts above. */
      if (key === "payment_banks") value = cleanBankFilter(value);
      /* «Заказ ждёт оплаты»: the day the switch was turned ON is stamped into
         the blob here, because this route is the only place that can see the
         transition — it knows what the flows row said a moment ago and what it
         is about to say. Nothing else in the shop, and nobody in the panel,
         ever writes that field: it is the line the backlog goes quietly under
         (src/lib/flows.ts stampUnpaidFloor, and the `unpaidFrom` note on the
         Flows type). Same first door as everything above it. */
      if (key === "flows") value = await stampUnpaidFloor(value);
      await setSetting(key, value);
      await writeAuditSafe("admin", "setting.set", { key, value });
      /* src/lib/shipping.ts caches the tariff row for a minute. Without this
         the owner saves a price in «Настройки → Доставка» and the very next
         checkout still bills the old one — which is exactly the "the panel
         says one thing, the shop charges another" the editor exists to fix. */
      if (key === "shipping_rules") {
        try {
          (await import("@/lib/shipping")).resetShippingRulesCache();
        } catch {
          // no shipping module, nothing to invalidate
        }
      }
    }
  } catch (err) {
    console.error("[api/admin/settings] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }

  /* The read-back is a courtesy, not part of the write, so it sits OUTSIDE
     the try above — the write is done by now. Inside it, a `getSettings()`
     that failed (the pool ran dry, the connection dropped between the two
     statements) answered `db_unavailable`, 503, about a row that was already
     written and a tariff cache that was already reset: the panel then said
     «Не удалось сохранить на сервере — попробуйте ещё раз» about a change
     that had been saved. The panel is told what happened, not what happened
     to the answer; a read that fails simply sends no `settings` back, and
     every caller already treats that field as optional. */
  try {
    return Response.json({ ok: true, settings: await getSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/settings] saved, but the read-back failed:", err);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  }
}
