/**
 * The nightly backup poll — Montonio's advice of 24.09.2026.
 *
 * «15 attempts total … over roughly 1.5–2 days. Since you rely solely on the
 * webhook for tracking, we'd still recommend occasionally polling shipment
 * status via GET as a backup, in case an event ever ends up undelivered.»
 *
 * `syncStaleShipments()` rides the daily cron (/api/cron/flows → runFlows):
 * every shipment quiet for SHIPMENT_QUIET_HOURS is asked for with
 * `GET /shipments/{id}` and the answer applied exactly as the webhook would
 * have (applyShipmentUpdate). Montonio is a stub here — `fetchShipment` — and
 * the database is the real schema in PGlite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import type { MontonioShipment } from "@/lib/shipping/montonio";
import { SHIPMENT_POLL_LIMIT, syncStaleShipments } from "@/lib/shipping/shipment-sync";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-25T07:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();

let seq = 0;
/** An order holding one Montonio shipment; `montonio` overrides the stored record. */
async function orderWith(montonio: Record<string, unknown>, status = "shipped"): Promise<{ id: string; shipmentId: string }> {
  seq += 1;
  const shipmentId = `0000000${seq}-aaaa-4bbb-8ccc-${String(seq).padStart(12, "0")}`;
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, status, shipping)
     values ($1, 'buyer@example.com', 'Тест', $2, $3::jsonb) returning id`,
    [
      `R-2000${String(seq).padStart(2, "0")}`,
      status,
      JSON.stringify({
        method: "parcel",
        country: "EE",
        montonio: {
          provider: "montonio",
          shipmentId,
          carrier: "omniva",
          status: "registered",
          trackingCode: "CC000000001EE",
          createdAt: ago(72),
          ...montonio,
        },
      }),
    ],
  );
  return { id: rows[0].id, shipmentId };
}

async function montonioOf(id: string): Promise<Record<string, unknown>> {
  const rows = await query<{ m: Record<string, unknown> }>("select shipping->'montonio' as m from orders where id = $1", [id]);
  return rows[0].m;
}
async function statusOf(id: string): Promise<string> {
  return (await query<{ status: string }>("select status from orders where id = $1", [id]))[0].status;
}
async function journal(action: string) {
  return query<{ actor: string; payload: Record<string, unknown> }>(
    "select actor, payload from admin_audit where action = $1 order by id",
    [action],
  );
}

/** Montonio, stubbed: an answer per shipment id, and a record of what was asked. */
function montonio(answers: Record<string, Partial<MontonioShipment> | Error>) {
  const asked: string[] = [];
  const fetchShipment = async (id: string): Promise<MontonioShipment> => {
    asked.push(id);
    const a = answers[id];
    if (a instanceof Error) throw a;
    return {
      provider: "montonio",
      shipmentId: id,
      status: "registered",
      carrier: "omniva",
      country: "EE",
      method: "pickupPoint",
      trackingCode: "",
      trackingUrl: "",
      dropOffPin: "",
      createdAt: "",
      ...(a ?? {}),
    };
  };
  return { asked, fetchShipment };
}

const configured = () => true;

describe("the nightly shipment poll", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
  });

  it("does nothing without Montonio keys", async () => {
    const m = montonio({});
    const run = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured: () => false });
    expect(run).toMatchObject({ checked: 0, reason: "not_configured" });
    expect(m.asked).toEqual([]);
  });

  it("finds a registration that finished without its webhook and fills in the tracking code", async () => {
    /* Refused at the button press, repaired or re-tried by Montonio since —
       and the `shipment.registered` event lost. */
    const o = await orderWith({ status: "registrationFailed", trackingCode: "", statusAt: ago(20) }, "paid");
    const m = montonio({
      [o.shipmentId]: { status: "registered", trackingCode: "CC777EE", trackingUrl: "https://minu.omniva.ee/track/CC777EE" },
    });
    const run = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(run).toMatchObject({ checked: 1, changed: 1, tracking: 1, refused: 0, closed: 0, errors: 0 });
    expect(await montonioOf(o.id)).toMatchObject({
      status: "registered",
      trackingCode: "CC777EE",
      trackingUrl: "https://minu.omniva.ee/track/CC777EE",
      polledAt: new Date(NOW).toISOString(),
    });
    expect(await statusOf(o.id)).toBe("paid");
  });

  it("closes a shipped order whose «delivered» never arrived", async () => {
    const o = await orderWith({ status: "inTransit", statusAt: ago(30) });
    const m = montonio({ [o.shipmentId]: { status: "delivered" } });
    const run = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(run).toMatchObject({ checked: 1, changed: 1, closed: 1 });
    expect(await statusOf(o.id)).toBe("delivered");
    expect((await montonioOf(o.id)).status).toBe("delivered");
    const rows = await journal("order.status");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("system");
  });

  it("journals a refusal the webhook lost — once, however many nights it stays refused", async () => {
    const o = await orderWith({ status: "pending", trackingCode: "", statusAt: ago(15) }, "paid");
    const m = montonio({ [o.shipmentId]: { status: "registrationFailed" } });
    const first = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(first).toMatchObject({ checked: 1, refused: 1 });
    const rows = await journal("shipment.registration_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ source: "poll", shipmentId: o.shipmentId, code: "registrationFailed" });

    const next = await syncStaleShipments({ now: NOW + 24 * HOUR, fetchShipment: m.fetchShipment, configured });
    expect(next).toMatchObject({ checked: 1, refused: 0, changed: 0 });
    expect(await journal("shipment.registration_failed")).toHaveLength(1);
  });

  it("leaves alone what is final, set aside, closed, or heard from recently", async () => {
    const delivered = await orderWith({ status: "delivered", statusAt: ago(50) });
    const returned = await orderWith({ status: "returned", statusAt: ago(50) });
    const dismissed = await orderWith({ status: "registered", statusAt: ago(50), dismissed: true }, "paid");
    const cancelled = await orderWith({ status: "registered", statusAt: ago(50) }, "cancelled");
    const fresh = await orderWith({ status: "inTransit", statusAt: ago(3) });
    const polled = await orderWith({ status: "inTransit", statusAt: ago(40), polledAt: ago(2) });
    const quiet = await orderWith({ status: "inTransit", statusAt: ago(40) });
    const m = montonio({});
    const run = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(m.asked).toEqual([quiet.shipmentId]);
    expect(run.checked).toBe(1);
    for (const o of [delivered, returned, dismissed, cancelled, fresh, polled]) {
      expect(m.asked).not.toContain(o.shipmentId);
    }
  });

  it("is idempotent: the same answer twice writes nothing but the time it asked", async () => {
    const o = await orderWith({ status: "inTransit", statusAt: ago(30) });
    const m = montonio({ [o.shipmentId]: { status: "awaitingCollection" } });
    const first = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(first.changed).toBe(1);
    const second = await syncStaleShipments({ now: NOW + 24 * HOUR, fetchShipment: m.fetchShipment, configured });
    expect(second).toMatchObject({ checked: 1, changed: 0, closed: 0 });
    expect(await montonioOf(o.id)).toMatchObject({
      status: "awaitingCollection",
      polledAt: new Date(NOW + 24 * HOUR).toISOString(),
    });
    expect(await statusOf(o.id)).toBe("shipped");
  });

  it("asks at most SHIPMENT_POLL_LIMIT a night, least recently asked first", async () => {
    const all: string[] = [];
    for (let i = 0; i < SHIPMENT_POLL_LIMIT + 5; i++) {
      all.push((await orderWith({ status: "inTransit", statusAt: ago(40) })).shipmentId);
    }
    const m = montonio({});
    const first = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(first).toMatchObject({ checked: SHIPMENT_POLL_LIMIT, left: 5 });

    // the next night starts with the five nobody asked about yet
    const m2 = montonio({});
    await syncStaleShipments({ now: NOW + 24 * HOUR, fetchShipment: m2.fetchShipment, configured });
    const skipped = all.filter((id) => !m.asked.includes(id));
    expect(skipped).toHaveLength(5);
    expect(m2.asked.slice(0, 5).sort()).toEqual(skipped.sort());
  });

  it("stops when its share of the cron's minute is spent", async () => {
    for (let i = 0; i < 6; i++) await orderWith({ status: "inTransit", statusAt: ago(40) });
    const slow = montonio({});
    const fetchShipment = async (id: string) => {
      await new Promise((r) => setTimeout(r, 450));
      return slow.fetchShipment(id);
    };
    const run = await syncStaleShipments({ now: NOW, fetchShipment, configured, budgetMs: 1_000 });
    expect(run.checked).toBeLessThan(6);
    expect(run.left).toBe(6 - run.checked);
  });

  it("counts a shipment Montonio would not answer for and carries on", async () => {
    const bad = await orderWith({ status: "inTransit", statusAt: ago(40), polledAt: ago(30) });
    const good = await orderWith({ status: "inTransit", statusAt: ago(40), polledAt: ago(29) });
    const m = montonio({ [bad.shipmentId]: new Error("unreachable"), [good.shipmentId]: { status: "delivered" } });
    const run = await syncStaleShipments({ now: NOW, fetchShipment: m.fetchShipment, configured });
    expect(run).toMatchObject({ checked: 2, errors: 1, closed: 1 });
    expect(await statusOf(bad.id)).toBe("shipped");
    expect(await statusOf(good.id)).toBe("delivered");
  });
});

describe("the daily cron runs it", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("reports it beside the other jobs, and without keys says why it did nothing", async () => {
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    const { runFlows } = await import("@/lib/flows");
    const report = await runFlows(NOW);
    expect(report.shipments).toMatchObject({ checked: 0, reason: "not_configured" });
  });
});
