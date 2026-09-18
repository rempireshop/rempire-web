/**
 * Two places on the owner's order card that said something untrue, both in
 * public/shop2/app.js and both found by the r21 audit sweep:
 *
 *   · a «Отправить счёт ещё раз» the server refused left no warning at all —
 *     the card kept the date of the FIRST letter and the two `sendError`
 *     lines were `else if` alternatives to it, so once `sentAt` was set
 *     neither could ever draw again;
 *   · a status PATCH the server refused still left its line in the journal,
 *     with a «Вернуть» button under it, claiming a step nobody took.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the functions are
 * sliced out of app.js by source text and run against stubs — the technique
 * tests/admin-panel-truth.test.ts and tests/blog-panel-shop.test.ts use. The
 * slice fails loudly if app.js drops or renames one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** `function <name>(…) { … }` cut out by brace matching. */
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

/** One `else if (…) { … }` branch of a dispatcher, found after `marker`. */
function branchAfter(marker: string, head: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has «${marker}»`);
  const start = src.indexOf(head, at);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has the branch «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1).replace(/^else\s+/, "");
  }
  throw new Error(`unbalanced braces in the branch «${head}»`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- «По счёту» on the card: a resend that did not go ------------- */

type Invoice = { number: string; dueAt: string; sentAt: string | null; sendError: string; paidAt: string | null };

function invoiceState(inv: Partial<Invoice>, over: { unpaid?: boolean; overdue?: number; iban?: string } = {}): string {
  const run = new Function(
    "esc", "admInvoiceDate", "admOverdueText", "companyIban",
    slice("admInvoiceStateHTML") + "\nreturn admInvoiceStateHTML;",
  )(
    (s: unknown) => String(s ?? ""),
    (s: unknown) => String(s ?? ""),
    (n: number) => `Просрочен на ${n} дн.`,
    () => over.iban ?? "EE38 2200 2210 2014 5685",
  ) as (v: unknown) => string;
  return run({
    invoice: { number: "A-2026-0042", dueAt: "2026-09-13", sentAt: null, sendError: "", paidAt: null, ...inv },
    unpaid: over.unpaid ?? true,
    overdue: over.overdue ?? 0,
  });
}

describe("«Письмо со счётом» on the order card", () => {
  it("says the letter went out when it did", () => {
    const html = invoiceState({ sentAt: "2026-09-06T09:00:00.000Z" });
    expect(html).toContain("Письмо ушло");
    expect(html).not.toContain("не ушло");
  });

  it("names the reason when the very first letter never left", () => {
    expect(invoiceState({ sendError: "no_api_key" })).toContain("Письмо со счётом не ушло (no_api_key)");
    expect(invoiceState({ sendError: "no_iban" }, { iban: "" })).toContain("в «Реквизитах» нет IBAN");
  });

  /* The case that had no line at all: the invoice went out on day one, the
     owner pressed «Отправить счёт ещё раз» a week later and Resend refused.
     resendInvoice() keeps `sentAt` and rewrites `sendError` only, so the card
     has both — and drew only the first. */
  it("warns about a resend that failed even though the first letter went out", () => {
    const html = invoiceState({ sentAt: "2026-09-06T09:00:00.000Z", sendError: "no_api_key" });
    expect(html).toContain("Письмо ушло");
    expect(html).toContain("Письмо со счётом не ушло (no_api_key)");
    expect(html).toContain("«Отправить счёт ещё раз»");
  });

  it("…and about a resend refused for a missing IBAN, with the way out", () => {
    const html = invoiceState({ sentAt: "2026-09-06T09:00:00.000Z", sendError: "no_iban" }, { iban: "" });
    expect(html).toContain("Письмо ушло");
    expect(html).toContain("«Настройки → О компании»");
  });
});

/* ---------- «Отметить оплаченным»: the toast says what the server said --- */

/** What apiSend() hands back — the shape the panel's own handlers read. */
type Reply = { status: number; body: Record<string, unknown> };

async function markPaid(answer: Reply): Promise<string[]> {
  const toasts: string[] = [];
  const run = new Function(
    "apiSend", "SRV", "render", "toast", "journalNote", "admOrdersChanged",
    slice("srvInvoicePaid") + "\nreturn srvInvoicePaid;",
  )(
    () => Promise.resolve(answer),
    { admin: true },
    () => {},
    (m: string) => toasts.push(m),
    () => {},
    () => {},
  ) as (id: string, number: string, invoiceNumber: string) => void;
  run("ord-1", "R-100042", "A-2026-0042");
  await flush();
  return toasts;
}

describe("the toast after «Отметить оплаченным»", () => {
  it("says the letter went out when the server says it did", async () => {
    expect(await markPaid({ status: 200, body: { ok: true, sent: true, skipped: false } }))
      .toEqual(["R-100042 оплачен по счёту · письмо ушло"]);
  });

  /* The payment is recorded either way — that is the news. What changed is
     that the shop no longer claims the customer was written to when its own
     mail door reported a refusal or a missing key. */
  it("does not claim the letter went out when the server says it did not", async () => {
    expect(await markPaid({ status: 200, body: { ok: true, sent: false, skipped: true } }))
      .toEqual(["R-100042 оплачен по счёту · письмо не ушло"]);
  });

  it("still says «уже был оплачен» on a second press", async () => {
    expect(await markPaid({ status: 200, body: { ok: true, alreadyPaid: true, sent: false } }))
      .toEqual(["R-100042 уже был оплачен"]);
  });
});

/* ---------- «Создать этикетку» that booked but did not save ------------- */

async function makeLabel(answer: Reply): Promise<string[]> {
  const toasts: string[] = [];
  const shipErr = src.slice(src.indexOf("var SHIP_ERR = {"), src.indexOf("};", src.indexOf("var SHIP_ERR = {")) + 2);
  const run = new Function(
    "SRV", "admOrderById", "render", "apiSend", "demoApply", "toast", "loadSrvOrders", "countryName",
    /* srvMsg is sliced in, not stubbed: since r23-live-ready the server names
       which refusal this is and sends the sentence, and srvCreateShipment
       prints it ahead of SHIP_ERR. Stubbing it would test our fallback map
       instead of what the owner actually reads. */
    [shipErr, slice("srvMsg"), slice("shipCourierErr"), slice("srvCreateShipment"), "return srvCreateShipment;"].join("\n"),
  )(
    { shipBusy: false },
    () => ({ number: "R-100042" }),
    () => {},
    () => Promise.resolve(answer),
    () => ({}),
    (m: string) => toasts.push(m),
    () => {},
    (c: string) => c,
  ) as (id: string) => void;
  run("ord-1");
  await flush();
  return toasts;
}

describe("the toast after «Создать этикетку»", () => {
  it("says the label is ready when it is", async () => {
    expect(await makeLabel({ status: 200, body: { ok: true, shipment: { trackingCode: "EE1" } } }))
      .toEqual(["Этикетка готова ✓"]);
  });

  /* The parcel exists at Montonio and the shop has been charged for it; only
     the row recording it failed to save (POST /api/admin/shipments →
     store_failed). The card used to fall through to «Не удалось создать
     этикетку», which says the opposite of what happened and invites a second
     press — and the booking claim expires after two minutes, so a second press
     books, and pays for, a second parcel. */
  it("says the parcel exists rather than that nothing happened", async () => {
    const [said] = await makeLabel({
      status: 500,
      body: { ok: false, error: "store_failed", shipment: { trackingCode: "EE1" } },
    });
    expect(said).toContain("Montonio");
    expect(said).toContain("второй раз не создавайте");
    expect(said).not.toBe("Не удалось создать этикетку");
  });

  it("still names the refusals it always named", async () => {
    expect(await makeLabel({ status: 409, body: { ok: false, error: "not_paid" } }))
      .toEqual(["Этикетка создаётся после оплаты."]);
    expect(await makeLabel({ status: 409, body: { ok: false, error: "in_progress" } }))
      .toEqual(["Этикетка уже создаётся — подождите минуту и откройте заказ заново."]);
    expect(await makeLabel({ status: 502, body: { ok: false, error: "shipment_failed" } }))
      .toEqual(["Не удалось создать этикетку"]);
  });
});

/* ---------- the journal must not keep a step the server refused --------- */

/** …or no answer at all: a dropped connection, which has its own branch. */
type ReplyOrThrow = Reply | "throw";

async function pushStatus(answer: ReplyOrThrow): Promise<{ log: unknown[]; toasts: string[]; saves: number }> {
  const entry = { txt: "Заказ R-100042: Отправлен" };
  const DEMO = { log: [entry, { txt: "что-то раньше" }] as unknown[] };
  let saves = 0;
  const journalDrop = new Function(
    "DEMO", "demoSave",
    slice("journalDrop") + "\nreturn journalDrop;",
  )(DEMO, () => { saves++; }) as (e: unknown) => void;

  const toasts: string[] = [];
  const branch = branchAfter(
    "// «Заказы»: the status the card moved, and the status undo moves back",
    'else if (a.type === "order_status")',
  );
  const run = new Function(
    "a", "entry", "SRV", "apiSend", "toast", "journalDrop", "admOrdersChanged", "render",
    branch,
  );
  run(
    { type: "order_status", id: "ord-1", number: "R-100042", value: "shipped", prev: "paid" },
    entry,
    { stepBusy: "" },
    () => (answer === "throw" ? Promise.reject(new Error("offline")) : Promise.resolve(answer)),
    (m: string) => toasts.push(m),
    journalDrop,
    () => {},
    () => {},
  );
  await flush();
  return { log: DEMO.log, toasts, saves };
}

describe("«Отправлен» / «Доставлен» that the server refused", () => {
  it("keeps the journal line when the status really was saved", async () => {
    const r = await pushStatus({ status: 200, body: { ok: true } });
    expect(r.log).toHaveLength(2);
    expect(r.toasts).toEqual([]);
    expect(r.saves).toBe(0);
  });

  /* Before this, the line and its «Вернуть» button stayed: the journal —
     the one place the owner looks to see what he did today — claimed a step
     the shop had never taken, and «Вернуть» offered to undo it. */
  it("takes the line back out when the PATCH was refused", async () => {
    const r = await pushStatus({ status: 409, body: { ok: false, error: "bad_status" } });
    expect(r.toasts).toEqual(["Не удалось сохранить статус"]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ txt: "что-то раньше" });
    expect(r.saves).toBe(1);   // …and the shorter journal is what survives a reload
  });

  it("…and when the request never came back at all", async () => {
    const r = await pushStatus("throw");
    expect(r.log).toHaveLength(1);
    expect(r.saves).toBe(1);
  });
});
