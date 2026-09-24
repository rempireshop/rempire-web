/**
 * POST /api/admin/shipments/  — { orderId } → register the parcel with a carrier
 *
 * The button behind «Создать этикетку» on the admin's order card. It hands the
 * order's shipping jsonb (parcel-machine id, or the courier address) to
 * Montonio, which registers it with Omniva / DPD / SmartPosti / Venipak and
 * hands back a tracking code; the result is merged into
 * `orders.shipping.montonio` so the label route and the panel can find it.
 *
 * **It registers, and nothing else.** The order's status stays exactly where
 * it was — a label is a sticker, not a hand-over: the parcel is still on the
 * shelf until the owner presses «Отправлен», which is its own explicit step
 * (PATCH /api/admin/orders/<id> { status: "shipped" } — that is where the
 * status moves and the customer's «Заказ отправлен» letter, tracking link
 * included, goes out). This route used to flip the order to `shipped` and
 * send the letter by itself, and the owner's complaint was exactly that:
 * «нажимаю „этикетка“ — меняется весь статус».
 *
 * Order of work, deliberately:
 *   1. Montonio first — nothing is written until the carrier accepted the parcel.
 *   2. then the order row, then admin_audit.
 *
 * Idempotent: a second press returns the shipment already stored rather than
 * booking (and paying for) a second parcel. A shipment the journal's undo had
 * set aside (`dismissed`, see MontonioShipment) is brought back the same way —
 * the parcel at the carrier is the same parcel. And a press that arrives while
 * the FIRST one is still inside Montonio — the timed-out tap on the owner's
 * phone — is answered `in_progress` rather than booking a second one: the slot
 * on the order row is claimed before the call (claimShipmentSlot).
 *
 * **A parcel the carrier refused is not a success** (since 18.09.2026,
 * docs/montonio-shipping-audit.md § 1.4). We book with `synchronous: true`, so
 * Montonio answers with the final registration status — `registered` **or**
 * `registrationFailed` — and this route used to store either one, write
 * «этикетка создана» to the journal and answer `ok: true`. The owner saw
 * «Этикетка готова ✓» for a parcel that will never move, and the label call
 * after it failed with nothing to explain itself.
 *
 * Now a `registrationFailed` reply is:
 *   · **stored anyway** — the shipment really does exist at Montonio, and
 *     forgetting it would let the next press book (and pay for) a second one;
 *   · answered `502 registration_failed`, with `reason` and RU/ET/EN
 *     `messages` naming what to fix (src/lib/montonio-problems.ts);
 *   · written to the journal as `shipment.registration_failed`, not as
 *     `shipment.create`.
 *
 * **And the next press REPAIRS it** (since 24.09.2026). Montonio's answer that
 * day: «you don't need to create a new shipment. `registrationFailed` is one
 * of three states from which a shipment can be updated via PATCH, and PATCH
 * automatically triggers a new registration attempt with the carrier. If the
 * attempt fails again, the shipment simply stays in that same
 * `registrationFailed` state (nothing is lost), and you can just try again.
 * This fits well with the "one clear button" solution you described». So the
 * button stays «Создать этикетку», and on a refused shipment it:
 *   1. takes the repair slot (claimRepairSlot — a timed-out tap cannot send
 *      the same parcel twice at once);
 *   2. asks Montonio first (`GET /shipments/{id}`): Montonio re-tries a
 *      refusal by itself, and a PATCH on a shipment that has registered since
 *      would register it AGAIN — so a shipment that is no longer refused is
 *      simply stored as it now is;
 *   3. otherwise sends the SAME shipment again, `PATCH /shipments/{id}`, built
 *      from the order as it stands now (repairMontonioShipment) — a corrected
 *      phone or address, a different box or door, all go with it;
 *   4. stores the answer; a refusal again is the same 502 as before, and the
 *      press after it tries again. Never a second shipment, never a second
 *      booking to pay for.
 * Until that answer a second press repeated the stored refusal without asking
 * Montonio, and the panel told the owner to set the label aside and «create it
 * anew» — which could only ever repeat the refusal. Sandbox cannot produce
 * this state at all: it never calls a carrier (docs/montonio-untested.md, S1).
 */
import { requireAdmin } from "@/lib/auth";
import { shipmentRegistrationFailed } from "@/lib/montonio-problems";
import { getOrder, getOrderByNumber, writeAuditSafe } from "@/lib/orders";
import type { Order } from "@/lib/orders";
import {
  MontonioShippingError,
  claimRepairSlot,
  claimShipmentSlot,
  createMontonioShipment,
  getMontonioShipment,
  releaseRepairSlot,
  releaseShipmentSlot,
  repairMontonioShipment,
  saveShipmentOnOrder,
  shipmentOnOrder,
  type CreateShipmentOptions,
  type MontonioShipment,
} from "@/lib/shipping/montonio";
import { shippingMockOn } from "@/lib/shipping/montonio-mock";
import {
  getParcelSettings,
  noteLockerSize,
  suggestedLockerSize,
  toLockerSize,
} from "@/lib/shipping/parcel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which failures are the operator's fault (400) and which are ours (502). */
const CLIENT_ERRORS = new Set(["not_shippable", "point_unresolved", "no_courier_service"]);

/**
 * The one status that means «the carrier said no» — overview § Shipment
 * lifecycle, and the only non-`registered` outcome a synchronous booking can
 * answer with (shipments guide § Creating a shipment synchronously).
 */
const REGISTRATION_FAILED = "registrationfailed";

function registrationRefused(shipment: Pick<MontonioShipment, "status">): boolean {
  return String(shipment.status ?? "").trim().toLowerCase() === REGISTRATION_FAILED;
}

/** The same answer whether the refusal has just arrived or is already stored. */
function refusedResponse(shipment: MontonioShipment) {
  const reading = shipmentRegistrationFailed(shipment.status);
  return Response.json(
    {
      ok: false,
      error: "registration_failed",
      reason: reading.reason,
      messages: reading.messages,
      detail: shipment.status,
      shipment,
    },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

/**
 * `{ length, width, height }` in centimetres from the panel → metres for
 * Montonio, or `null` when the body carries no usable box.
 *
 * All three sides or none: two of them describe nothing, and a parcel with a
 * length and no height is a 400 from Montonio rather than a smaller one.
 * Bounds are the same 1–200 cm the panel's fields carry, so a value that got
 * past the screen is still refused here.
 */
function cleanBox(raw: unknown): { length: number; width: number; height: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const side of ["length", "width", "height"] as const) {
    const cm = Number(x[side]);
    if (!Number.isFinite(cm) || cm <= 0 || cm > 200) return null;
    out[side] = Math.round((cm / 100) * 100) / 100;
  }
  return out as { length: number; width: number; height: number };
}

/** A Montonio call that failed, as the panel reads it — booking and repair alike. */
function montonioFailure(err: unknown, what: "create" | "repair"): Response {
  if (err instanceof MontonioShippingError) {
    const status = err.code === "not_configured" ? 501 : CLIENT_ERRORS.has(err.code) ? 400 : 502;
    console.error(`[api/admin/shipments] montonio refused the ${what}:`, err.code, err.detail);
    /* Only for the refusals whose cause is inside Montonio's own words —
       `rejected` carries «400 {…}» from the transport. The codes the panel
       already has a sentence for (not_shippable, point_unresolved,
       no_courier_service, not_configured) keep theirs: they are ours, they
       are right, and two sources for one message is how they drift. */
    const reading = err.code === "rejected" ? shipmentRegistrationFailed(err.detail) : null;
    return Response.json(
      {
        ok: false,
        error: err.code,
        detail: err.detail,
        ...(reading ? { reason: reading.reason, messages: reading.messages } : {}),
      },
      { status },
    );
  }
  console.error(`[api/admin/shipments] ${what} failed:`, err);
  return Response.json({ ok: false, error: "shipment_failed" }, { status: 502 });
}

type Body = {
  orderId?: unknown;
  order?: unknown;
  weight?: unknown;
  carrier?: unknown;
  lockerSize?: unknown;
  box?: unknown;
};

/** The label-time choices a press carries: weight, carrier, door, box. */
async function pressOptions(body: Body): Promise<CreateShipmentOptions> {
  /* The locker door, and the only place it can honestly be decided: the owner
     is standing over the box he has just packed. The panel pre-selects one and
     posts it, so pressing the button is a confirmation and not a question —
     but the *default* is the server's, not the panel's, so a press from a tab
     that never loaded the settings (or from the assistant, or from a test)
     still books with the size he has been shipping rather than with none at
     all. Ренат, 18.09.2026: «use recommended, but we have also option that
     some default is set and used + automate it». */
  const parcel = await getParcelSettings();
  const lockerSize = toLockerSize(body.lockerSize) ?? suggestedLockerSize(parcel);

  /* «Другая коробка» — this parcel's own measurements, in **centimetres**,
     which is what the three fields on the card say and what the owner reads
     off a tape. They are converted once, here, because `POST /shipments` is
     metric (reference § Create Shipment → parcels) while
     `POST /shipping-methods/rates` is centimetric; both are right and neither
     is to be made to agree with the other.
     An explicit box always goes out. The shop's *declared* carton does not —
     createMontonioShipment() fills that in only where Montonio says the route
     requires dimensions, so nothing this adds can move a size tier on a
     booking that already worked. This one is the owner saying «эта посылка
     другая», and it is honoured. */
  const box = cleanBox(body.box);
  return {
    weight: typeof body.weight === "number" && body.weight > 0 ? body.weight : undefined,
    carrier: typeof body.carrier === "string" && body.carrier ? body.carrier : undefined,
    lockerSize,
    ...(box ?? {}),
  };
}

/**
 * «Создать этикетку» on a shipment the carrier refused: the SAME shipment,
 * sent again — never a new one, as often as he presses. See the header.
 */
async function repairRefused(order: Order, existing: MontonioShipment & Record<string, unknown>, body: Body) {
  let claimed = false;
  try {
    claimed = await claimRepairSlot(order.id);
  } catch (err) {
    console.error("[api/admin/shipments] could not claim the repair slot:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!claimed) return Response.json({ ok: false, error: "in_progress" }, { status: 409 });

  const attempts = Math.max(0, Math.trunc(Number(existing.repairs) || 0));
  let shipment: MontonioShipment;
  let patched = false;
  try {
    /* Ask before sending. Montonio re-tries a refused registration by itself
       («Our system will automatically attempt to register the Shipment again
       if the status is registrationFailed» — shipments guide), and PATCH is
       also allowed on a `registered` shipment, where it registers the parcel
       AGAIN. So the shipment is only sent while Montonio itself still calls it
       refused. (The e2e carrier never refuses and has no GET.) */
    const now = shippingMockOn() ? existing : await getMontonioShipment(existing.shipmentId);
    if (!registrationRefused(now)) {
      shipment = {
        ...existing,
        status: now.status || existing.status,
        trackingCode: now.trackingCode || existing.trackingCode,
        trackingUrl: now.trackingUrl || existing.trackingUrl,
        dropOffPin: now.dropOffPin || existing.dropOffPin,
      };
    } else {
      const opts = await pressOptions(body);
      const repaired = await repairMontonioShipment(order, existing, opts);
      patched = true;
      shipment = {
        ...existing,
        ...repaired,
        // the booking's own date stays the booking's; the repair has its own stamp
        createdAt: existing.createdAt || repaired.createdAt,
        trackingCode: repaired.trackingCode || existing.trackingCode,
      };
    }
  } catch (err) {
    // nothing changed at Montonio that we know of: the button must work again at once
    await releaseRepairSlot(order.id).catch(() => {});
    return montonioFailure(err, "repair");
  }

  const at = new Date().toISOString();
  const record: Record<string, unknown> = {
    status: shipment.status,
    statusAt: at,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    trackingUrl: shipment.trackingUrl,
    dropOffPin: shipment.dropOffPin,
    // the label step is his again — a repaired parcel is not «set aside»
    dismissed: false,
    repairAt: null,
  };
  if (patched) {
    record.repairs = attempts + 1;
    record.repairedAt = at;
    if (shipment.lockerSize) record.lockerSize = shipment.lockerSize;
  }
  try {
    await saveShipmentOnOrder(order.id, record);
  } catch (err) {
    console.error("[api/admin/shipments] could not store the repaired shipment:", err);
    await releaseRepairSlot(order.id).catch(() => {});
    return Response.json({ ok: false, error: "store_failed", shipment }, { status: 500 });
  }
  const stored = { ...existing, ...record, dismissed: false } as MontonioShipment & Record<string, unknown>;

  if (registrationRefused(shipment)) {
    console.error(`[api/admin/shipments] carrier refused ${order.number} again (attempt ${attempts + 1})`);
    await writeAuditSafe("admin", "shipment.registration_failed", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: shipment.shipmentId,
      carrier: shipment.carrier,
      code: shipment.status,
      reason: shipmentRegistrationFailed(shipment.status).reason,
      attempt: attempts + 1,
    });
    return refusedResponse(stored);
  }

  if (patched && shipment.method === "pickupPoint" && shipment.lockerSize) {
    await noteLockerSize(shipment.lockerSize);
  }
  await writeAuditSafe("admin", "shipment.repair", {
    orderId: order.id,
    number: order.number,
    provider: "montonio",
    shipmentId: shipment.shipmentId,
    carrier: shipment.carrier,
    code: shipment.status,
    trackingCode: shipment.trackingCode || undefined,
    // false: Montonio had registered it by itself before the press
    patched,
  });
  return Response.json(
    { ok: true, repaired: true, patched, shipment: stored, order },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const id = String(body.orderId ?? body.order ?? "").trim();
  if (!id) return Response.json({ ok: false, error: "bad_order" }, { status: 400 });

  let order;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/admin/shipments] order read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const existing = shipmentOnOrder(order);
  if (existing) {
    /* A refused registration is stored so nobody books a second parcel — and
       the press is the repair: the SAME shipment, sent again with PATCH
       (Montonio, 24.09.2026; see the header). */
    if (registrationRefused(existing)) return repairRefused(order, existing, body);
    if (existing.dismissed) {
      try {
        await saveShipmentOnOrder(order.id, { dismissed: false });
      } catch (err) {
        console.error("[api/admin/shipments] could not bring the shipment back:", err);
        return Response.json({ ok: false, error: "store_failed", shipment: existing }, { status: 500 });
      }
      await writeAuditSafe("admin", "shipment.step", { orderId: order.id, number: order.number, labelStep: true });
    }
    return Response.json(
      { ok: true, reused: true, shipment: { ...existing, dismissed: false }, order },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // An unpaid parcel is a parcel nobody has been charged for.
  if (order.status !== "paid" && order.status !== "shipped") {
    return Response.json({ ok: false, error: "not_paid", detail: order.status }, { status: 409 });
  }

  /* The slot is taken BEFORE Montonio is called. Everything above ran against
     a snapshot of the order, and between "there is no shipment here" and the
     write at the bottom sits a live call to a carrier: a press that timed out
     on the owner's phone and was pressed again booked — and paid for — a
     second parcel. `false` means another press is inside that call right now
     (claimShipmentSlot, which expires by itself). */
  let claimed = false;
  try {
    claimed = await claimShipmentSlot(order.id);
  } catch (err) {
    console.error("[api/admin/shipments] could not claim the booking slot:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!claimed) return Response.json({ ok: false, error: "in_progress" }, { status: 409 });

  let shipment;
  try {
    // the door and «Другая коробка» — pressOptions() above says how each is decided
    shipment = await createMontonioShipment(order, await pressOptions(body));
  } catch (err) {
    // nothing was booked, so the button must work again at once
    await releaseShipmentSlot(order.id).catch(() => {});
    return montonioFailure(err, "create");
  }

  try {
    // the claim goes out with the same write that records the parcel
    await saveShipmentOnOrder(order.id, { ...shipment, bookingAt: null });
  } catch (err) {
    // The parcel exists at the carrier; losing the row is bad but not fatal —
    // report it with the tracking code so nobody books it twice.
    console.error("[api/admin/shipments] could not store the shipment:", err);
    return Response.json({ ok: false, error: "store_failed", shipment }, { status: 500 });
  }

  /* Stored, and then refused. The order of these two is the whole point: the
     shipment exists at Montonio whatever its status, so it is written down
     first and only then reported as the failure it is. */
  if (registrationRefused(shipment)) {
    console.error(
      `[api/admin/shipments] carrier refused ${order.number}: ${shipment.carrier} ${shipment.status}`,
    );
    await writeAuditSafe("admin", "shipment.registration_failed", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: shipment.shipmentId,
      carrier: shipment.carrier,
      code: shipment.status,
      reason: shipmentRegistrationFailed(shipment.status).reason,
    });
    return refusedResponse(shipment);
  }

  /* What he actually pressed, remembered, so the next label offers it without
     being asked. Only for a shipment that could carry a size at all — a
     courier parcel and an Omniva locker never take one, and counting them
     would teach the suggestion a number nobody chose. Best effort: the parcel
     is booked, and a forgotten size is not a failed label. */
  /* …and only a size that was really DECLARED. `shipment.lockerSize` is what
     the request actually put on the wire; until 19.09.2026 this asked whether
     the carrier in Montonio's REPLY takes a size, while the request had asked
     the same of the carrier HINT. An order with an empty stored carrier and a
     Montonio point UUID books SmartPosti with no size at all — and was then
     recorded as having chosen one, teaching the suggestion a door nobody
     picked, with an audit row claiming it too (audit F28.2). */
  if (shipment.method === "pickupPoint" && shipment.lockerSize) {
    await noteLockerSize(shipment.lockerSize);
  }

  await writeAuditSafe("admin", "shipment.create", {
    orderId: order.id,
    number: order.number,
    provider: "montonio",
    shipmentId: shipment.shipmentId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    lockerSize: shipment.lockerSize,
  });

  // The status is the order's own: still `paid` (or whatever it was) — see the header.
  return Response.json(
    { ok: true, shipment, order },
    { headers: { "cache-control": "no-store" } },
  );
}
