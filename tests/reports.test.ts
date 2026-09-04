/**
 * The accountant export's own math and file formats — VAT split, date
 * ranges, the CSV writer, and the hand-rolled xlsx (zip) writer, which is
 * novel enough code (no dependency, see src/lib/reports.ts's own comment)
 * that it gets a real round-trip test, not just "did it throw".
 *
 * listReportOrders / ordersHasChannelColumn touch PGlite — see the describe
 * block at the bottom.
 */
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { createOrder, setOrderStatus, type Order } from "@/lib/orders";
import {
  buildZip,
  DEFAULT_VAT_RATE,
  explicitRange,
  listReportOrders,
  monthRange,
  ordersHasChannelColumn,
  ordersToCsv,
  ordersToXlsx,
  reportOrderColumns,
  REPORT_COLUMNS,
  resetChannelColumnCache,
  resolveVatRate,
  summarize,
  vatSplit,
  type ReportOrderRow,
} from "@/lib/reports";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* ---------- pure math ------------------------------------------------------ */

describe("vatSplit", () => {
  it("splits a VAT-inclusive total at the given rate, cent-exact", () => {
    // 124 € gross at 24% is exactly 100 € net + 24 € VAT
    expect(vatSplit(124, 24)).toEqual({ net: 100, vat: 24 });
  });
  it("the two parts always foot back to the (rounded) gross total", () => {
    const { net, vat } = vatSplit(19.9, 24);
    expect(Math.round((net + vat) * 100) / 100).toBe(19.9);
  });
  it("handles zero", () => {
    expect(vatSplit(0, 24)).toEqual({ net: 0, vat: 0 });
  });
});

describe("resolveVatRate", () => {
  it("defaults to 24% (the Estonian standard rate since 1 July 2025) when unset or invalid", () => {
    expect(resolveVatRate(undefined)).toBe(DEFAULT_VAT_RATE);
    expect(resolveVatRate(null)).toBe(DEFAULT_VAT_RATE);
    expect(resolveVatRate("not a number")).toBe(DEFAULT_VAT_RATE);
    expect(resolveVatRate(-5)).toBe(DEFAULT_VAT_RATE);
    expect(resolveVatRate(150)).toBe(DEFAULT_VAT_RATE);
  });
  it("accepts a configured rate", () => {
    expect(resolveVatRate(22)).toBe(22);
    expect(resolveVatRate("20")).toBe(20);
  });
});

describe("monthRange / explicitRange", () => {
  it("turns YYYY-MM into a half-open [first, next-first) range", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-03-01" });
  });
  it("rolls December into the next year", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
  it("rejects a malformed month", () => {
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("not-a-month")).toBeNull();
    expect(monthRange("")).toBeNull();
  });
  it("explicitRange treats `to` as inclusive, pushing it one day out", () => {
    expect(explicitRange("2026-08-01", "2026-08-31")).toEqual({ from: "2026-08-01", to: "2026-09-01" });
  });
  it("explicitRange rejects `to` before `from`, and malformed dates", () => {
    expect(explicitRange("2026-08-31", "2026-08-01")).toBeNull();
    expect(explicitRange("2026-08-01", "not-a-date")).toBeNull();
  });
});

/* ---------- CSV ------------------------------------------------------------- */

function row(over: Partial<ReportOrderRow> = {}): ReportOrderRow {
  return {
    number: "R-100042",
    date: "2026-08-15",
    customerName: "Test Ostja",
    customerEmail: "test@example.com",
    country: "EE",
    channel: "web",
    deliveryMethod: "courier",
    subtotal: 100,
    shipping: 3.49,
    discount: 0,
    discountCode: "",
    total: 103.49,
    vatRate: 24,
    vatAmount: 20.03,
    totalExclVat: 83.46,
    paymentProvider: "montonio",
    paymentRef: "abc123",
    status: "paid",
    ...over,
  };
}

describe("ordersToCsv", () => {
  it("starts with a UTF-8 BOM (Excel needs it for Cyrillic to render)", () => {
    const csv = ordersToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it("uses ; as the delimiter and carries every column in the header", () => {
    const csv = ordersToCsv([row()]);
    const header = csv.replace("﻿", "").split("\r\n")[0];
    expect(header.split(";")).toHaveLength(REPORT_COLUMNS.length);
    expect(header).toContain("Order");
    expect(header).toContain("VAT amount");
  });
  it("quotes a field that contains the delimiter or a quote, doubling inner quotes", () => {
    const csv = ordersToCsv([row({ customerName: 'Tamm; "VIP"' })]);
    expect(csv).toContain('"Tamm; ""VIP"""');
  });
  it("formats money to two decimals", () => {
    const csv = ordersToCsv([row({ total: 19.9 })]);
    expect(csv).toContain("19.90");
  });
  it("one data row per order, in the header's column order", () => {
    const csv = ordersToCsv([row({ number: "R-1" }), row({ number: "R-2" })]);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1].startsWith("R-1")).toBe(true);
    expect(lines[2].startsWith("R-2")).toBe(true);
  });
});

/* ---------- xlsx (hand-rolled zip) ------------------------------------------ */

/** Walks the local file headers this exact writer produces and inflates each
 *  entry — a real round-trip check of buildZip()/ordersToXlsx(), not just
 *  "it didn't throw". Mirrors the writer's own layout (extraLen always 0). */
function readZipEntries(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset < buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name] = (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
    offset = dataStart + compSize;
  }
  return out;
}

describe("buildZip / ordersToXlsx", () => {
  it("round-trips arbitrary entries through the local file headers", () => {
    const buf = buildZip([
      { name: "hello.txt", data: Buffer.from("hello world", "utf8") },
      // long, repetitive text compresses smaller than stored — exercises the deflate path
      { name: "big.txt", data: Buffer.from("abcdefgh".repeat(500), "utf8") },
    ]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const entries = readZipEntries(buf);
    expect(entries["hello.txt"]).toBe("hello world");
    expect(entries["big.txt"]).toBe("abcdefgh".repeat(500));
  });

  it("produces the OOXML parts Excel needs, with the order rows in the sheet", () => {
    const buf = ordersToXlsx([row({ number: "R-100042", total: 103.49 }), row({ number: "R-100043", total: 55 })]);
    const entries = readZipEntries(buf);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
      ]),
    );
    const sheet = entries["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("R-100042");
    expect(sheet).toContain("R-100043");
    expect(sheet).toContain("<v>103.49</v>");
    // header row carries the column labels as text (inline strings)
    expect(sheet).toContain('t="inlineStr"');
    expect(entries["[Content_Types].xml"]).toContain("spreadsheetml");
  });

  it("escapes text that would otherwise break the XML", () => {
    const buf = ordersToXlsx([row({ customerName: 'Tamm & <VIP> "special"' })]);
    const sheet = readZipEntries(buf)["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Tamm &amp; &lt;VIP&gt; &quot;special&quot;");
    expect(sheet).not.toContain("<VIP>");
  });
});

describe("summarize", () => {
  it("adds up orders/revenue/VAT across rows", () => {
    const s = summarize([row({ total: 100, vatAmount: 19.35 }), row({ total: 50, vatAmount: 9.68 })]);
    expect(s).toEqual({ orders: 2, revenue: 150, vat: 29.03 });
  });
  it("is all zero for an empty month", () => {
    expect(summarize([])).toEqual({ orders: 0, revenue: 0, vat: 0 });
  });
});

/* ---------- DB-backed: listReportOrders / ordersHasChannelColumn ----------- */

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

async function paidOrder(overrides: Partial<{ email: string; name: string }> = {}): Promise<Order> {
  const created = await createOrder({
    lang: "RU",
    items: [{ id: product.id, qty: 1 }],
    customer: { name: overrides.name ?? "Test Ostja", email: overrides.email ?? "test@example.com", phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
  });
  return (await setOrderStatus(created.id, "paid", "test"))!;
}

describe("listReportOrders (PGlite)", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetChannelColumnCache();
  });

  it("ordersHasChannelColumn detects orders.channel (db/migrations/091_pos_channel.sql, inventory agent's range)", async () => {
    expect(await ordersHasChannelColumn()).toBe(true);
  });

  it("reads the real channel column when it is present", async () => {
    const order = await paidOrder();
    const rows = await listReportOrders("2000-01-01", "2100-01-01", 24);
    const found = rows.find((r) => r.number === order.number);
    expect(found).toBeDefined();
    expect(found!.channel).toBe("web"); // createOrder()'s own checkout path, same as the column's own default
    expect(found!.status).toBe("paid");
    expect(found!.vatRate).toBe(24);
  });

  it("defensive query: the SELECT list only names `channel` when the column exists", () => {
    // The realistic "does not exist yet" scenario used to be tested by
    // dropping the real column live — no longer safe to simulate that way:
    // src/lib/orders.ts's createOrder() now hard-depends on this column
    // (db/migrations/091_pos_channel.sql plus the inventory agent's own
    // changes to that shared file), so a dropped column breaks order
    // creation itself, not just this route. reportOrderColumns() is the
    // pure fragment-builder this route actually runs off — this is a
    // faithful, DB-free test of the same "check with a defensive query"
    // logic the task asked for.
    expect(reportOrderColumns(true)).toContain(", channel");
    expect(reportOrderColumns(false)).not.toContain("channel");
  });

  it("only includes orders that reached payment (new/failed/cancelled are excluded)", async () => {
    const created = await createOrder({
      lang: "RU",
      items: [{ id: product.id, qty: 1 }],
      customer: { name: "Never Paid", email: "unpaid@example.com", phone: "+372 5555 5555" },
      shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
    });
    const rows = await listReportOrders("2000-01-01", "2100-01-01", 24);
    expect(rows.find((r) => r.number === created.number)).toBeUndefined();
  });

  it("respects the date range (a range that excludes today finds nothing)", async () => {
    await paidOrder();
    const rows = await listReportOrders("1999-01-01", "1999-02-01", 24);
    expect(rows).toHaveLength(0);
  });

  it("computes the VAT split at the rate it is given", async () => {
    const order = await paidOrder();
    const rows = await listReportOrders("2000-01-01", "2100-01-01", 22);
    const found = rows.find((r) => r.number === order.number)!;
    const expected = Math.round((found.total - found.total / 1.22) * 100) / 100;
    expect(found.vatAmount).toBeCloseTo(expected, 2);
    expect(found.vatRate).toBe(22);
  });

  it("reads the customer name/email and country from the order", async () => {
    const order = await paidOrder({ name: "Мария Тамм", email: "maria@example.com" });
    const rows = await listReportOrders("2000-01-01", "2100-01-01", 24);
    const found = rows.find((r) => r.number === order.number)!;
    expect(found.customerName).toBe("Мария Тамм");
    expect(found.customerEmail).toBe("maria@example.com");
    expect(found.country).toBe("EE");
  });
});
