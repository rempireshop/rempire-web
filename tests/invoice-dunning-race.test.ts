/**
 * «Отметить оплаченным» pressed while the nightly dunning walk is running.
 *
 * The walk selects its batch once and then works through it (src/lib/
 * invoice-dunning.ts). saveInvoiceRecord() replaces the WHOLE `orders.invoice`
 * blob, so a reminder stamped onto the snapshot would write the record as it
 * was before the payment — `paidAt: null` — back over the one the owner had
 * just marked paid, and mail the company a demand for money it had already
 * sent. The cancellation half has always re-read the order for this reason;
 * the reminder half now does too, and this is the proof.
 *
 * Its own file because of the mock below: the race needs something to happen
 * BETWEEN the batch query and the reminder's write, and invoiceSeller() is the
 * one await that sits there.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { runInvoiceDunning } from "@/lib/invoice-dunning";
import { addDays, invoiceOf, markInvoicePaid, saveInvoiceRecord, tallinnDate } from "@/lib/invoices";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* Runs once, inside the walk, the next time the reminder asks the shop who is
   sending the invoice. Everything else in src/lib/invoices.ts stays real —
   only the module's OWN importers see this, so createOrder()'s issueInvoice()
   is untouched. */
let midWalk: (() => Promise<void>) | null = null;
vi.mock("@/lib/invoices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoices")>();
  return {
    ...actual,
    invoiceSeller: async () => {
      const hook = midWalk;
      midWalk = null;
      if (hook) await hook();
      return actual.invoiceSeller();
    },
  };
});

type Min = { id: string; p: number; s: string };
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;
const plain = (catalogueMin as Min[]).find((p) => p.s === "in" && !VARIANTS[p.id])!;

const COMPANY = {
  name: "Salong Näidis OÜ",
  regCode: "16123456",
  vatNumber: "EE101234567",
  address: "Pärnu mnt 10, 10148 Tallinn",
  email: "raamatupidaja@example.com",
};

const ENV_KEYS = ["RESEND_API_KEY", "E2E_BOOTSTRAP", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

/** The invoice due in two days — the reminder's own window. */
async function dueSoon(id: string, dueDays = 7): Promise<void> {
  const inv = invoiceOf(await getOrder(id))!;
  const dueAt = addDays(tallinnDate(), 2);
  await saveInvoiceRecord(id, {
    ...inv,
    issueDate: addDays(dueAt, -dueDays),
    dueAt,
    dueDays,
    // no key here, so nothing ever really left: stamped by hand, because
    // neither step chases an invoice the company never received
    sentAt: `${addDays(dueAt, -dueDays)}T09:00:00.000Z`,
    sendError: "",
  });
}

function sinkClear(): void {
  (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
}

describe("«Отметить оплаченным» during the nightly walk", () => {
  beforeAll(async () => {
    await setupDb();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.RESEND_API_KEY;
    process.env.E2E_BOOTSTRAP = "1";
    process.env.SESSION_SECRET = TEST_SECRET;
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    await query("truncate invoice_counters");
    midWalk = null;
    sinkClear();
    await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
  });

  it("keeps the payment and sends no reminder when the money lands mid-walk", async () => {
    const order = await createOrder({
      lang: "RU",
      items: [{ id: plain.id, qty: 2 }],
      customer: { name: "Mari Tamm", email: "mari@example.com", phone: "+372 5555 5555" },
      shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
      payment: { method: "invoice" },
      company: COMPANY,
    } as Parameters<typeof createOrder>[0]);
    await dueSoon(order.id);
    sinkClear();

    // the owner sees the transfer on the statement and presses the button
    // while the cron is already walking this very order
    midWalk = async () => {
      const fresh = (await getOrder(order.id))!;
      await markInvoicePaid(fresh, { setOrderPayment, setOrderStatus }, "admin");
    };

    const run = await runInvoiceDunning();

    const inv = invoiceOf(await getOrder(order.id))!;
    // the money is still recorded — the whole point
    expect(inv.paidAt).toBeTruthy();
    expect(inv.remindedAt).toBeNull();
    expect((await getOrder(order.id))?.status).toBe("paid");
    // …and the company is not asked for money it has already sent
    expect(capturedMail().filter((m) => m.template === "invoice-reminder")).toHaveLength(0);
    expect(run).toMatchObject({ reminded: 0, skipped: 1 });
  });
});
