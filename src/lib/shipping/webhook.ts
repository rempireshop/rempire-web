/**
 * `shipment.statusUpdated` — the carrier's own word for where the parcel is.
 *
 * Why this exists. src/lib/delivery.ts decides an order was delivered by
 * matching the carrier's `status` against a white list of six words. This file
 * used to say **«the vocabulary of that field is not in the reference we
 * have»**, and that was wrong: the overview page prints the whole lifecycle
 * (pending, registered, registrationFailed, labelsCreated, inTransit,
 * awaitingCollection, delivered, returned) and the shipments guide repeats it —
 * «the status can change from registered to inTransit, awaitingCollection,
 * delivered, or returned». What the docs genuinely do not promise is whether a
 * carrier's own wording is ever passed through instead. Dim's answer,
 * 08.09.2026: register the webhook and watch what actually arrives, so the real
 * vocabulary can be read off production rather than assumed.
 *
 * So this module does two things, and keeps them apart on purpose:
 *
 *   1. **Record.** Every distinct status string that arrives is kept in
 *      `settings.shipping_statuses` with a count, the first and last time it
 *      was seen, and what the white list made of it. That row is the answer to
 *      «what does Montonio actually send», and it is readable without a deploy:
 *      `GET /api/admin/settings/` (owner only). The first sighting of a word
 *      also goes into the shop's journal, so a status nobody has seen before
 *      surfaces by itself rather than waiting to be looked for.
 *   2. **Act — on the white list, which is still a guess.** statusMeaning()
 *      below asks looksDelivered() / looksReturned() from src/lib/delivery.ts,
 *      the same two functions the nightly cron uses. **This is the fallback,
 *      not the answer**: it stays in force only until the recorded vocabulary
 *      says what the real words are, and it errs the same way it always has —
 *      a word it does not know moves nothing.
 *
 * The token is verified exactly the way the payment webhook's is
 * (src/lib/payments/montonio.ts, verifyToken): HS256 only, our own secret, our
 * own accessKey, and a token that names nothing is refused rather than acted
 * on. Nothing here is softer because the payload is «only» a parcel status —
 * this endpoint can close an order.
 */
import { looksDelivered, looksReturned } from "@/lib/delivery";
import { setSetting, writeAuditSafe } from "@/lib/orders";
import { query } from "@/lib/db";
import { JwtError, verifyHs256 } from "@/lib/payments/jwt";
import type { MontonioConfig } from "@/lib/payments/montonio";

/** settings key holding the vocabulary we are here to learn. */
export const SHIPMENT_STATUS_SETTING = "shipping_statuses";

/** A dictionary is a few words long. This cap only stops a broken sender from
    growing the settings row without end — a real vocabulary never reaches it. */
export const MAX_TRACKED_STATUSES = 40;

export type ShipmentWebhookErrorCode =
  | "bad_body"
  | "missing_token"
  | "token_invalid"
  | "token_expired"
  | "token_foreign"
  | "token_no_reference";

export class ShipmentWebhookError extends Error {
  constructor(readonly code: ShipmentWebhookErrorCode) {
    super(code);
    this.name = "ShipmentWebhookError";
  }
}

/** What one webhook says, in our words. */
export interface ShipmentEvent {
  /** Montonio's event name — `shipment.statusUpdated`, and whatever else it sends. */
  event: string;
  /** The shipment's own id: how the order is found when the token names no order. */
  shipmentId: string;
  /** `merchantReference` — our order number — when the token carries one. */
  orderRef: string;
  /** The status **exactly as it arrived**. This is the word we are here to learn. */
  status: string;
  trackingCode: string;
}

/** What the white list makes of a status — "" when it recognises neither. */
export type ShipmentMeaning = "delivered" | "returned" | "";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The claims of one webhook → our five fields.
 *
 * **The shipment is inside `data`, and that is not a guess.** The webhooks
 * guide prints a whole decoded token:
 *
 *   { eventId, shipmentId, created, eventType, iat, exp,
 *     data: { id, status, merchantReference, shippingMethod, receiver,
 *             parcels: [{ carrierParcelId, trackingLink, … }], … } }
 *
 * Only `eventType` and `shipmentId` live at the top level. Until 18.09.2026
 * this function looked at the top level and at a `claims.shipment` object that
 * has never existed, so `status` and `merchantReference` came back empty on
 * every real notification and the route answered «no_status» and threw the
 * event away — silently, with a 200, for months. The comment that used to
 * stand here said the guide «does not print a sample of the claims», which is
 * how a guess became a fixture (tests/shipping-webhook.test.ts) and the fixture
 * made the guess look right. It prints one.
 *
 * The alternative spellings are kept: they cost nothing, a flat token still
 * works, and Montonio's own example token encodes `orderId` where the
 * pretty-printed copy beside it says `merchantReference`. Whichever arrives is
 * stored verbatim — nothing is renamed, because the point of this endpoint is
 * still to find out what really comes.
 */
function readEvent(claims: Record<string, unknown>): ShipmentEvent {
  const data = obj(claims.data);
  const scopes = [claims, data, obj(claims.shipment)];
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      for (const scope of scopes) {
        const v = str(scope[k]);
        if (v) return v;
      }
    }
    return "";
  };
  const parcel = obj(Array.isArray(data.parcels) ? data.parcels[0] : undefined);
  return {
    event: pick("event", "eventType", "type", "topic"),
    shipmentId: pick("shipmentId", "id"),
    orderRef: pick("merchantReference", "orderReference", "orderNumber", "orderId"),
    status: pick("status", "shipmentStatus", "state"),
    trackingCode: pick("trackingCode", "carrierParcelId") || str(parcel.carrierParcelId),
  };
}

/**
 * The body of one webhook → a verified event.
 *
 * `{ payload: <JWT> }` is Montonio's shipping envelope (the payments side calls
 * the same field `orderToken`); `token` and `data` are accepted alongside it
 * because the three Montonio APIs already spell this three ways between them
 * and a webhook we could not read would be recorded as nothing at all.
 *
 * Throws on anything unusable — the route turns that into a 4xx, which is the
 * one answer a retry could never fix. (The «48 hours» this comment used to
 * claim is the payments guide's; the shipping one documents no retry policy at
 * all — audit F27.)
 */
export function verifyShipmentWebhook(body: unknown, config: MontonioConfig): ShipmentEvent {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ShipmentWebhookError("bad_body");
  const b = body as Record<string, unknown>;
  const token = str(b.payload) || str(b.token) || str(b.data);
  if (!token) throw new ShipmentWebhookError("missing_token");

  let claims: Record<string, unknown>;
  try {
    claims = verifyHs256(token, config.secretKey);
  } catch (err) {
    throw new ShipmentWebhookError(
      err instanceof JwtError && err.code === "jwt_expired" ? "token_expired" : "token_invalid",
    );
  }
  // A valid signature from *another* Montonio store is still not ours — the
  // same check, in the same place, as the payment webhook's verifyToken().
  if (claims.accessKey && str(claims.accessKey) !== config.accessKey) {
    throw new ShipmentWebhookError("token_foreign");
  }

  const event = readEvent(claims);
  if (!event.shipmentId && !event.orderRef) throw new ShipmentWebhookError("token_no_reference");
  return event;
}

/**
 * What the white list makes of a carrier status.
 *
 * **A guess, and marked as one.** looksDelivered() and looksReturned() are the
 * six-word allow-list in src/lib/delivery.ts, written before anybody had seen a
 * real status, and this webhook exists to replace them with the real
 * vocabulary. Until it has, they are what decides — unchanged, including the
 * rule that matters most: a word neither of them recognises means «not yet»
 * and moves nothing.
 */
export function statusMeaning(status: string): ShipmentMeaning {
  if (looksReturned(status)) return "returned";
  if (looksDelivered(status)) return "delivered";
  return "";
}

/** One word of the vocabulary, as it is stored. */
export interface ShipmentStatusNote {
  /** How many webhooks have carried this word. */
  count: number;
  /** ISO stamps of the first and the most recent sighting. */
  first: string;
  last: string;
  /** The event that carried it last — `shipment.statusUpdated` unless Montonio sends more. */
  event: string;
  /** What the white list made of it: "delivered", "returned", or "" for неизвестно. */
  meaning: ShipmentMeaning;
  /** One shipment id carrying it, so a puzzling word can be looked up at Montonio. */
  shipment: string;
}

export type ShipmentStatusBook = Record<string, ShipmentStatusNote>;

/** Long enough for any real word, short enough that a junk body cannot bloat
    the settings row. Stored as it arrived otherwise — case, spaces and all. */
function statusWord(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 64);
}

function note(raw: unknown): ShipmentStatusNote | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const count = Number(r.count);
  return {
    count: Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0,
    first: str(r.first),
    last: str(r.last),
    event: str(r.event),
    meaning: r.meaning === "delivered" || r.meaning === "returned" ? r.meaning : "",
    shipment: str(r.shipment),
  };
}

/** The vocabulary as it stands. `{}` — never a throw — when it is unreadable. */
export async function readStatusBook(): Promise<ShipmentStatusBook> {
  let raw: unknown;
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = $1", [
      SHIPMENT_STATUS_SETTING,
    ]);
    raw = rows.length ? rows[0].value : null;
  } catch (err) {
    console.error("[shipping webhook] settings.shipping_statuses unreadable —", err);
    return {};
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ShipmentStatusBook = {};
  for (const [word, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = note(value);
    if (n) out[word] = n;
  }
  return out;
}

/**
 * Write one sighting into the vocabulary.
 *
 * Read, merge, write — not one atomic statement. Two webhooks landing in the
 * same millisecond could therefore cost one increment, and that is an
 * acceptable price here: this row is a field notebook, not a ledger, and
 * Montonio delivers a handful of these a day. The order's own status is not
 * written from here at all (that is setOrderStatus, and it is idempotent).
 *
 * Returns whether this was the first time the shop has ever seen the word.
 */
export async function recordShipmentStatus(
  event: ShipmentEvent,
  now: Date = new Date(),
): Promise<{ word: string; first: boolean; meaning: ShipmentMeaning }> {
  const word = statusWord(event.status);
  const meaning = statusMeaning(word);
  if (!word) return { word, first: false, meaning };

  const book = await readStatusBook();
  const seen = book[word];
  const at = now.toISOString();
  const first = !seen;

  if (first && Object.keys(book).length >= MAX_TRACKED_STATUSES) {
    console.error(`[shipping webhook] status vocabulary is full — «${word}» not recorded`);
    return { word, first: false, meaning };
  }

  book[word] = {
    count: (seen?.count ?? 0) + 1,
    first: seen?.first || at,
    last: at,
    event: event.event || seen?.event || "",
    meaning,
    shipment: event.shipmentId || seen?.shipment || "",
  };

  try {
    await setSetting(SHIPMENT_STATUS_SETTING, book);
  } catch (err) {
    /* The recording is the whole point of this endpoint, so a failure here is
       worth a retry — the route turns it into a 503 and Montonio comes back. */
    console.error("[shipping webhook] could not write settings.shipping_statuses —", err);
    throw err;
  }

  if (first) {
    /* Only the first sighting reaches the journal. Every sighting would bury
       Renat's own changes under a carrier's chatter — and the news is the word
       itself, not the hundredth parcel to carry it. */
    await writeAuditSafe("system", "shipment.status", {
      /* `code` on purpose: the journal line is «слово + то, к чему оно
         относится», and auditText() reads that second half from number → code
         → key → … . Here the news IS the status word, so it goes in the field
         that wins; the order number rides along under a name that does not. */
      code: word,
      meaning: meaning || "unknown",
      event: event.event || undefined,
      shipmentId: event.shipmentId || undefined,
      order: event.orderRef || undefined,
    });
  }

  return { word, first, meaning };
}
