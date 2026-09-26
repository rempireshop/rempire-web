/**
 * The panel's side of R-100098 (26.09.2026): what «Создать этикетку» says
 * when Montonio did not answer in time, and when the parcel it did make is
 * found and adopted instead of booked again.
 *
 * POST /api/admin/shipments answers `booking_unknown` with its own RU/ET/EN
 * sentence (src/lib/montonio-problems.ts, tests/shipment-booking-unknown.test.ts);
 * the panel must print that sentence in the owner's language — never «Не
 * удалось создать этикетку», which says nothing happened and invites the very
 * second press that would pay for a second parcel. An adopted parcel reads as
 * a label that is ready, and says it was found rather than made.
 *
 * srvCreateShipment() is sliced out of public/shop2/app.js and run against
 * stubs, the technique of tests/admin-order-card-r21.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

type Reply = { status: number; body: Record<string, unknown> };

async function makeLabel(answer: Reply, lang = "RU"): Promise<{ toasts: string[]; reloads: number }> {
  const toasts: string[] = [];
  let reloads = 0;
  const shipErr = src.slice(src.indexOf("var SHIP_ERR = {"), src.indexOf("};", src.indexOf("var SHIP_ERR = {")) + 2);
  const run = new Function(
    "S", "SRV", "admOrderById", "render", "apiSend", "demoApply", "toast", "countryName",
    "admShipBody", "admShipSpent", "admOrderListsReload",
    [shipErr, slice("srvMsg"), slice("shipCourierErr"), slice("srvCreateShipment"), "return srvCreateShipment;"].join("\n"),
  )(
    { lang },
    { shipBusy: false },
    () => ({ number: "R-100098" }),
    () => {},
    () => Promise.resolve(answer),
    () => ({}),
    (m: string) => toasts.push(m),
    (c: string) => c,
    (id: string) => ({ orderId: id }),
    () => {},
    () => { reloads += 1; },
  ) as (id: string) => void;
  run("ord-98");
  await flush();
  return { toasts, reloads };
}

const MESSAGES = {
  RU: "Montonio не ответил вовремя — посылка могла уже создаться. Подождите минуту и нажмите «Создать этикетку» ещё раз.",
  ET: "Montonio ei vastanud õigel ajal — pakk võib juba olemas olla. Oodake minut ja vajutage uuesti «Loo silt».",
  EN: "Montonio did not answer in time — the parcel may already exist. Wait a minute and press «Create the label» again.",
};

describe("«Создать этикетку» when Montonio did not answer in time", () => {
  it("prints the server's own sentence, in the owner's language", async () => {
    for (const lang of ["RU", "ET", "EN"] as const) {
      const { toasts } = await makeLabel(
        { status: 504, body: { ok: false, error: "booking_unknown", reason: "timeout", messages: MESSAGES } },
        lang,
      );
      expect(toasts).toEqual([MESSAGES[lang]]);
    }
  });

  it("without a sentence from the server it still never says «Не удалось создать этикетку»", async () => {
    const { toasts } = await makeLabel({ status: 504, body: { ok: false, error: "booking_unknown" } });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toBe("Не удалось создать этикетку");
    expect(toasts[0]).toContain("Montonio");
    expect(toasts[0]).toContain("вторую не создаст");
  });

  it("re-reads the lists, so a parcel the webhook has recorded since shows up on the card", async () => {
    const { reloads } = await makeLabel({ status: 409, body: { ok: false, error: "booking_unknown", reason: "waiting" } });
    expect(reloads).toBe(1);
  });
});

describe("a parcel Montonio already had, adopted instead of booked", () => {
  it("says the label is ready and that the parcel was found — not made a second time", async () => {
    const { toasts, reloads } = await makeLabel({
      status: 200,
      body: { ok: true, reused: true, adopted: true, shipment: { shipmentId: "3888e013", trackingCode: "09062026098EE" } },
    });
    expect(toasts).toEqual(["Посылка нашлась в Montonio — этикетка готова, вторая не создана ✓"]);
    // shown like any created label: every copy of the order is re-read
    expect(reloads).toBe(1);
  });

  it("a plain reuse and a fresh label keep their own words", async () => {
    expect((await makeLabel({ status: 200, body: { ok: true, reused: true, shipment: {} } })).toasts).toEqual([
      "Этикетка снова на месте ✓",
    ]);
    expect((await makeLabel({ status: 200, body: { ok: true, shipment: {} } })).toasts).toEqual(["Этикетка готова ✓"]);
  });
});

describe("the journal names the new rows", () => {
  const table = src.slice(src.indexOf("var AUDIT_WORDS = {"), src.indexOf("};", src.indexOf("var AUDIT_WORDS = {")) + 2);
  it("has a Russian line for adopt, booking_unknown and store_failed", () => {
    const words = new Function(`${table}; return AUDIT_WORDS;`)() as Record<string, string>;
    expect(words["shipment.adopt"]).toBeTruthy();
    expect(words["shipment.booking_unknown"]).toBeTruthy();
    expect(words["shipment.store_failed"]).toBeTruthy();
  });
});
